import { Suspense } from "react";
import { Workspace } from "./workspace";

export const metadata = { title: "Workspace — MedChrono AI" };

export default function WorkspacePage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
