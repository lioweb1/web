# Deploying MedChrono AI on AWS

This guide uses one CloudFormation stack (`infra/aws/medchrono.yml`) that creates everything the app needs:

```
Internet ──HTTPS──▶ Application Load Balancer ──▶ ECS Fargate (2+ containers) ──TLS──▶ RDS PostgreSQL (private subnets, encrypted)
                          │ HTTP→HTTPS redirect            │ secrets from Secrets Manager
                          │ 15-min idle timeout             │ logs → CloudWatch (90 days)
                                                            │ outbound → Anthropic API, Stripe, Amazon SES
```

**Rough cost:** about **$90–120/month** at launch (load balancer about $20, two 1 vCPU / 2 GB containers about $60, db.t4g.micro database with storage and backups about $20, plus secrets and logs). A Multi-AZ database adds about $15. AI usage is billed separately by Anthropic, and is covered by your per-case pricing.

You need **AWS CLI v2** (`aws configure` done), **Docker**, **git** and a domain name. Everything happens in one region; `us-east-1` is used below.

---

## 0. Compliance first (before any real records)

1. **Sign the AWS Business Associate Addendum:** AWS Console → **AWS Artifact** → Agreements → *AWS Business Associate Addendum* → Accept. Every service in this stack (ECS Fargate, ELB, RDS, Secrets Manager, CloudWatch, ECR, SES) is HIPAA-eligible.
2. **Sign a BAA with Anthropic** for API use with PHI. Contact Anthropic sales. Do not process real patient records until it is signed.
3. Turn on **MFA** for the root user and every IAM user, and turn on **CloudTrail** (one trail, all regions).
4. Stripe never receives PHI (only firm name and email). SES emails contain no PHI (password-reset and invite links only).

## 1. HTTPS certificate

AWS Console → **Certificate Manager** → Request → public certificate → `app.yourcompany.com` → DNS validation. Add the CNAME record it shows at your DNS provider and wait until the status is **Issued**. Copy the **certificate ARN**.

## 2. Email (Amazon SES)

1. **SES** → Identities → Create identity → Domain → `yourcompany.com`. Add the DKIM records it shows to your DNS.
2. **SES** → Account dashboard → **Request production access**. Until it is approved, SES can only send to verified addresses. Approval usually takes about a day.
3. **SES** → SMTP settings → **Create SMTP credentials**. Save the SMTP username and password for step 4.

You can skip email at first. Invite links are then shown to the firm owner to copy and send, but **password-reset emails won't work** until SES is set up.

## 3. Create the stack

```bash
aws cloudformation create-stack --region us-east-1 --stack-name medchrono \
  --template-body file://infra/aws/medchrono.yml \
  --capabilities CAPABILITY_IAM \
  --parameters \
    ParameterKey=DomainName,ParameterValue=app.yourcompany.com \
    ParameterKey=CertificateArn,ParameterValue=arn:aws:acm:us-east-1:123456789012:certificate/xxxx \
    ParameterKey=EmailFrom,ParameterValue="MedChrono AI <no-reply@yourcompany.com>" \
    ParameterKey=SmtpHost,ParameterValue=email-smtp.us-east-1.amazonaws.com \
    ParameterKey=AlarmEmail,ParameterValue=you@yourcompany.com \
    ParameterKey=DesiredCount,ParameterValue=0
```

```bash
aws cloudformation wait stack-create-complete --region us-east-1 --stack-name medchrono
```

The stack takes about 15 minutes, mostly for the database. `DesiredCount=0` means no containers start yet, because the image doesn't exist until step 5. If you'd rather click through the setup, use Console → CloudFormation → Create stack → *Upload a template file* with the same values.

## 4. Put your API keys in Secrets Manager

Console → **Secrets Manager** → `medchrono/app` → *Retrieve secret value* → **Edit**, and replace each `REPLACE_ME`:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `STRIPE_SECRET_KEY` | `sk_live_...` (or `sk_test_...` while testing) |
| `STRIPE_WEBHOOK_SECRET` | From step 7. Leave it as `REPLACE_ME` for now. |
| `SMTP_USER`, `SMTP_PASSWORD` | SES SMTP credentials from step 2 |

The app treats `REPLACE_ME` as "not configured", so a missing key turns that feature off instead of crashing the app. The database password is generated and stored in `medchrono/database` automatically.

## 5. Build and deploy the app

Optionally, create `medchrono/.env.production` with your public legal and contact details. These are baked into the image at build time:

```
NEXT_PUBLIC_SALES_EMAIL=sales@yourcompany.com
NEXT_PUBLIC_LEGAL_COMPANY=Your Company, LLC
NEXT_PUBLIC_LEGAL_ADDRESS=123 Main St, Wilmington, DE 19801
NEXT_PUBLIC_LEGAL_STATE=Delaware
NEXT_PUBLIC_LEGAL_EMAIL=legal@yourcompany.com
NEXT_PUBLIC_PRIVACY_EMAIL=privacy@yourcompany.com
```

Then, from the `medchrono/` folder:

```bash
STACK=medchrono AWS_REGION=us-east-1 DESIRED_COUNT=2 ./scripts/deploy-aws.sh
```

The script builds the Docker image, pushes it to the stack's ECR repository and updates the stack to run it. ECS replaces containers one at a time and **rolls back automatically** if the new version fails its health check (`/api/health`).

## 6. Point your domain at it

Get the load balancer address:

```bash
aws cloudformation describe-stacks --region us-east-1 --stack-name medchrono --query "Stacks[0].Outputs"
```

At your DNS provider, create a **CNAME** from `app.yourcompany.com` to the `LoadBalancerDns` value. On Route 53, use an *Alias A record* instead. Then open `https://app.yourcompany.com/api/health`; it should return `{"ok":true,"db":"up"}`.

## 7. Connect Stripe

Stripe Dashboard → Developers → **Webhooks** → Add endpoint `https://app.yourcompany.com/api/stripe/webhook` with these events:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`.

Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` in Secrets Manager. Also turn on the **Customer portal** under Settings → Billing. Then restart the containers so they pick up the new secret:

```bash
aws ecs update-service --region us-east-1 --cluster medchrono --service medchrono --force-new-deployment
```

Test with a Stripe test card (`4242 4242 4242 4242`) while you're on `sk_test_` keys.

---

## Day-to-day operations

| Task | How |
|---|---|
| Release a new version | `git pull`, then `STACK=medchrono AWS_REGION=us-east-1 ./scripts/deploy-aws.sh` |
| Change a secret | Edit it in Secrets Manager, then run the `force-new-deployment` command above |
| Roll back | Run the deploy script from an older commit (`git checkout <sha>`), or update the stack's `ImageTag` parameter to an earlier tag |
| Logs | CloudWatch → Log groups → `/ecs/medchrono` (or `aws logs tail /ecs/medchrono --follow`) |
| Scale | Autoscaling runs 2–10 containers by CPU. Change `DesiredCount` (minimum) or `TaskMemory` with `aws cloudformation update-stack ... --use-previous-template`. Use 4096 MB+ if customers upload 1,000+ page cases. |
| Database backups | Automatic daily snapshots, kept 14 days, with point-in-time restore (RDS console → Restore to point in time). Deleting the stack keeps a final snapshot, and deletion protection is on. |
| Alarms | Emails to `AlarmEmail` when there are no healthy containers, many 5xx errors, or high database CPU. Confirm the SNS subscription email first. |
| Production database | Set `DbMultiAz=true` once you have paying customers |

## Security notes

- Containers run in public subnets **with a public IP but no inbound access**: their security group only accepts traffic from the load balancer. This avoids a NAT gateway (about $35/month). For a stricter enterprise setup, move them to private subnets behind a NAT gateway.
- The database is in private subnets with no internet route, accepts connections only from the app, requires TLS (`rds.force_ssl`), and is encrypted at rest. The image includes the RDS certificate bundle, so the certificate is verified.
- Uploaded records never touch disk or the database. They live in container memory for the length of the request.
- For an extra layer, add **AWS WAF** to the load balancer with the AWS managed rule groups (common rules and IP reputation).
