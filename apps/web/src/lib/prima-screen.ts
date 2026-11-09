/** P92: a Prima screen named in the office's /prima address (/prima#clock from the phone's
 * Clock in tab) is passed on to Prima, which opens on it. Only a plain screen name is passed. */
export function primaScreen(hash: string): string {
  return /^#@?[a-z][a-z0-9-]{0,39}$/.test(hash) ? hash : "";
}
