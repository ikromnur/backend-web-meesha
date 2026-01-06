import "express-serve-static-core";

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

export {};

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

export {};