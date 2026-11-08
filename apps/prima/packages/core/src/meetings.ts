import type { IsoDate } from "./types";


export interface MinutesSummary {
  text: string;
  actions: { text: string; owner: string; due: IsoDate | null }[];
}

/** Summarises meeting minutes. Production plugs in the AI agent here. */
export interface MinutesReader {
  readonly name: string;
  readonly usesAi: boolean;
  summarise(minutes: string): MinutesSummary;
}

/**
 * Test version only: takes the first points of the minutes as the summary and every line starting "Action:" as an
 * action item, with "(Owner, by YYYY-MM-DD)" at the end.
 */
export const simpleMinutesReader: MinutesReader = {
  name: 'Simple reader (test version)'
,
  usesAi: false,
  summarise(minutes) {
    const lines = minutes
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const actions = lines
      .filter((l) => /^action\s*:/i.test(l))
      .map((l) => {
        const body = l.replace(/^action\s*:\s*/i, '');
        const m = /\(([^,()]+?)(?:,\s*by\s+(\d{4}-\d{2}-\d{2}))?\)\s*$/.exec(body);
        return { text: (m ? body.slice(0, m.index) : body).trim(), owner: m?.[1].trim() ?? 'Not named', due: (m?.[2] as IsoDate | undefined) ?? null };
      });
    const points = lines.filter((l) => !/^action\s*:/i.test(l)).slice(0, 3);
    return { text: points.join(' '), actions };
  }
};
