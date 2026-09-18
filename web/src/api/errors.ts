// Normalised form of the api.md §1 error envelope (plus client-side NETWORK_ERROR).
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { field?: string; issue?: string }[];
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, details: { field?: string; issue?: string }[] = [], requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function isUnauthenticated(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHENTICATED");
}
