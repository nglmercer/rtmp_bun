export class ResponseUtils {
  static json(
    data: any,
    additionalHeaders: Record<string, string> = {},
    status: number = 200,
  ): Response {
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        ...additionalHeaders,
      },
      status,
    });
  }

  static error(
    message: string,
    status: number = 500,
    additionalHeaders: Record<string, string> = {},
  ): Response {
    return this.json(
      { error: message },
      additionalHeaders,
      status
    );
  }

  static notFound(message: string = "Not found"): Response {
    return this.error(message, 404);
  }

  static badRequest(message: string = "Bad request"): Response {
    return this.error(message, 400);
  }

  static unauthorized(message: string = "Unauthorized"): Response {
    return this.error(message, 401);
  }

  static forbidden(message: string = "Forbidden"): Response {
    return this.error(message, 403);
  }

  static serverError(message: string = "Internal server error"): Response {
    return this.error(message, 500);
  }

  static success(message: string, data?: any): Response {
    return this.json({
      message,
      ...(data && { data })
    });
  }
}
