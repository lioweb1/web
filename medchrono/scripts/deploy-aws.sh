#!/usr/bin/env bash
# Build the image, push it to the stack's ECR repository and roll it out.
#
#   STACK=medchrono AWS_REGION=us-east-1 ./scripts/deploy-aws.sh            # deploy current commit
#   STACK=medchrono AWS_REGION=us-east-1 DESIRED_COUNT=2 ./scripts/deploy-aws.sh   # also set container count
#
# Needs: aws CLI v2 (logged in), docker. Public build-time settings are read from .env.production if present.
set -euo pipefail

STACK="${STACK:-medchrono}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
cd "$(dirname "$0")/.."

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

REPO="$(output EcrRepositoryUri)"
[ -n "$REPO" ] && [ "$REPO" != "None" ] || { echo "Stack $STACK not found in $REGION" >&2; exit 1; }
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
if [ -n "$(git status --porcelain . 2>/dev/null)" ]; then TAG="$TAG-dirty-$(date +%H%M%S)"; fi

BUILD_ARGS=()
if [ -f .env.production ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^NEXT_PUBLIC_[A-Z_]+$ ]] && BUILD_ARGS+=(--build-arg "$k=$v")
  done < .env.production
fi

echo "→ Logging in to ECR"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${REPO%%/*}"

echo "→ Building $REPO:$TAG"
docker build --platform linux/amd64 ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} -t "$REPO:$TAG" .
docker push "$REPO:$TAG"

PARAMS=(ParameterKey=ImageTag,ParameterValue="$TAG")
if [ -n "${DESIRED_COUNT:-}" ]; then
  PARAMS+=(ParameterKey=DesiredCount,ParameterValue="$DESIRED_COUNT")
else
  PARAMS+=(ParameterKey=DesiredCount,UsePreviousValue=true)
fi
for k in AppName DomainName CertificateArn TaskCpu TaskMemory DbInstanceClass DbMultiAz EmailFrom SmtpHost AlarmEmail; do
  PARAMS+=(ParameterKey=$k,UsePreviousValue=true)
done

echo "→ Updating stack $STACK to image $TAG"
aws cloudformation update-stack --region "$REGION" --stack-name "$STACK" \
  --use-previous-template --capabilities CAPABILITY_IAM --parameters "${PARAMS[@]}"
aws cloudformation wait stack-update-complete --region "$REGION" --stack-name "$STACK"
echo "✓ Deployed $TAG → $(output AppUrl)"
