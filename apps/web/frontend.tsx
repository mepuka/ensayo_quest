import React from "react";
import { ScorePanel } from "./components/ScorePanel";

export const Frontend = () => {
  return (
    <main>
      <h1>Ensayo Quest</h1>
      <ScorePanel turnId="t1" status="pending" overall={null} />
    </main>
  );
};
