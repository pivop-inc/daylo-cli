export class CliError extends Error {
  readonly code: string;
  readonly exitCode: 1 | 2;

  constructor(code: string, message: string, exitCode: 1 | 2 = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super("usage", message, 2);
    this.name = "UsageError";
  }
}
