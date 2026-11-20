export type ResourceJson =
  | null
  | boolean
  | number
  | string
  | readonly ResourceJson[]
  | {
      readonly [key: string]: ResourceJson;
    };
