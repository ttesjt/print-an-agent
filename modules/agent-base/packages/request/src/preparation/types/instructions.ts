export interface InstructionsStepContext<TRequest> {
  readonly state: { request?: TRequest; instructions?: string };
  readonly resources: {
    readonly instructionContributors: readonly ((context: {
      readonly request: TRequest;
    }) => string | Promise<string>)[];
    readonly policy: { readonly maxInstructionsCharacters: number };
  };
}
