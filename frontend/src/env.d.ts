interface ImportMeta {
  readonly glob: <T>(
    pattern: string,
    options?: {
      readonly eager?: boolean;
      readonly import?: string;
      readonly query?: string;
    },
  ) => Record<string, T>;
}
