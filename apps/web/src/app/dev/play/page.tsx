import { PracticePlayer } from "@/features/game/practice-player";
import { requireDeveloperPage } from "@/server/developer-access";
export default async function PracticePage() {
  await requireDeveloperPage();
  return (
    <>
      <h1>Game demo controls</h1>
      <PracticePlayer developerTools />
    </>
  );
}
