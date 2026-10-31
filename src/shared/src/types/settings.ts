/** User ownership is mandatory; secret settings require separately reviewed encryption. */
export type UserSetting = { userId: string; key: string } & (
  | { sensitivity: "ordinary"; value: unknown }
  | { sensitivity: "secret"; ciphertext: string }
);

export interface MonitorSample {
  userId: string;
  service: string;
  metric: string;
  value: number;
  sampledAt: number;
}
