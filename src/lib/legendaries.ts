// "Include Dragoon & Hydra": one choice shared by every page that has the
// checkbox, remembered in this browser.

import { useState } from "react";

const KEY = "air-riders-tracker.legendaries";

function read(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

export function useIncludeLegendaries(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(read);
  const set = (v: boolean) => {
    setValue(v);
    try { localStorage.setItem(KEY, v ? "on" : "off"); } catch { /* unavailable */ }
  };
  return [value, set];
}
