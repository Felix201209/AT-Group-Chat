export class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
  }
}

export function isClientError(error) {
  return error instanceof ClientError || Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;
}
