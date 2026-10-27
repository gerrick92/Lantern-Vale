import Link from "next/link";
import { requireDeveloperPage } from "@/server/developer-access";
import { loadGameDeploymentReview } from "@/server/game-deployment";
import { GameDeploymentPanel } from "@/features/deployment/game-panel";
import { GameActivation } from "@/features/deployment/game-activation";

export const metadata = { title: "Game contract review" };

export default async function GameDeploymentPage() {
  await requireDeveloperPage();
  let review;
  try {
    review = await loadGameDeploymentReview();
  } catch {
    return (
      <>
        <h1>Game contract review</h1>
        <p role="alert">
          The saved review is unavailable or differs from this build. Prepare
          and review the public plan before continuing.
        </p>
        <Link href="/settings">Back to settings</Link>
      </>
    );
  }
  return (
    <>
      <h1>Game contract review</h1>
      <GameActivation />
      <GameDeploymentPanel plan={review.plan} />
    </>
  );
}
