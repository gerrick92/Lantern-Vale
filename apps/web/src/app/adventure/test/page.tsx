import { notFound } from "next/navigation";
import { PrivatePage } from "@/components/private-page";
import { PracticePlayer } from "@/features/game/practice-player";

export default function TestAdventure() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <>
      <h1>Lantern Vale</h1>
      <PrivatePage>
        <PracticePlayer />
      </PrivatePage>
    </>
  );
}
