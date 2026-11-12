// K9 / N2: Arisha's training, the AI part (switched off until Fauzan's go-ahead). The trainer itself needs no call.
export interface TrainerClient {
  state(): Promise<{ ai: boolean }>;
  ask(input: { screen: string; guide: string; question: string; lang: 'en' | 'ms' | 'mix' }): Promise<{ refused: string | null; text: string }>;
}
