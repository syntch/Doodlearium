/**
 * Just enough of Express for the server's routes (server/routes.ts) to run in the page: the demo's requests
 * are answered right here instead of being sent anywhere (see transport.ts).
 */

export interface PageRequest {
  method: string;
  /** The path within the API: /drawings, /packs/abc... */
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  params: Record<string, string>;
}

export interface PageReply {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

type Next = () => void;
type Handler = (req: PageRequest, res: Reply, next: Next) => unknown;

class Reply {
  private code = 200;
  private headers: Record<string, string> = {};
  constructor(private done: (reply: PageReply) => void) {}

  status(code: number) {
    this.code = code;
    return this;
  }

  attachment(filename: string) {
    this.headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    return this;
  }

  json(body: unknown) {
    this.done({ status: this.code, headers: { ...this.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  end() {
    this.done({ status: this.code, headers: this.headers, body: null });
  }
}

interface Layer {
  method?: string;
  /** Matches the path, capturing its :params (none: every path). */
  pattern?: RegExp;
  names: string[];
  handlers: Handler[];
}

export function Router() {
  const layers: Layer[] = [];
  const route = (method: string) => (path: string, ...handlers: Handler[]) => {
    const names: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, name) => (names.push(name), '([^/]+)'))}/?$`);
    layers.push({ method, pattern, names, handlers });
  };
  return {
    use: (...handlers: Handler[]) => void layers.push({ names: [], handlers }),
    get: route('GET'),
    post: route('POST'),
    put: route('PUT'),
    delete: route('DELETE'),

    /** Runs a request through the routes, as Express would, and resolves to the answer. */
    answer(request: Omit<PageRequest, 'params'>) {
      return new Promise<PageReply>((resolve) => {
        const steps: { handler: Handler; params: Record<string, string> }[] = [];
        for (const layer of layers) {
          if (layer.method && layer.method !== request.method) continue;
          const match = layer.pattern ? layer.pattern.exec(request.path) : [];
          if (!match) continue;
          const params = Object.fromEntries(layer.names.map((name, i) => [name, decodeURIComponent(match[i + 1])]));
          for (const handler of layer.handlers) steps.push({ handler, params });
        }
        const res = new Reply(resolve);
        const failed = (err: unknown) => {
          console.error(err);
          res.status(500).json({ error: 'Something went wrong.' });
        };
        let at = 0;
        const next: Next = () => {
          const step = steps[at++];
          if (!step) return res.status(404).json({ error: 'not found' });
          try {
            Promise.resolve(step.handler({ ...request, params: step.params }, res, next)).catch(failed);
          } catch (err) {
            failed(err);
          }
        };
        next();
      });
    },
  };
}

export type PageRouter = ReturnType<typeof Router>;

/** (The page hands requests over already read, so there's nothing for a body parser to do.) */
const json = (_options?: unknown): Handler => (_req, _res, next) => next();

export default { Router, json };
