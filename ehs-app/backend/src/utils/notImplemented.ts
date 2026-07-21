import type { RequestHandler } from 'express';

export function notImplemented(section: string, capability: string): RequestHandler {
  return (_request, response) => {
    response.status(501).json({
      error: 'Not Implemented',
      capability,
      specification: `DESIGN.md ${section}`,
    });
  };
}
