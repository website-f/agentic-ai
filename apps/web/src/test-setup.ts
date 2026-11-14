import "@testing-library/jest-dom/vitest";

import { addDictionary } from "@/i18n";
import { MS } from "@/i18n/ms";

// P104: the app fetches the Malay text on demand (main.tsx); tests have it from the start.
addDictionary("ms", MS);
