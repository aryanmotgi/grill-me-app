import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./pill.css";
import { createRoot } from "react-dom/client";
import { Pill } from "./Pill";

createRoot(document.getElementById("pill-root")!).render(<Pill />);
