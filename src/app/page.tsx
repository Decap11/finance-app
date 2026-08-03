import React from "react";
import LandingPage from "../views/LandingPage";

// Open Graph / Twitter metadata is inherited from the root layout
// (src/utils/siteMetadata.ts) so every shared route gets the same link card.

export default function Page() {
  return <LandingPage />;
}
