// Tiny sandboxed expression evaluator for curve function strings like
// "100 - 0.5*x". Recursive descent, compiles to a closure. Never eval().

type Env = Record<string, number>;
type Evaluator = (env: Env) => number;

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

interface Token {
  kind: "num" | "ident" | "op";
  value: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new SyntaxError(`bad number at position ${i}`);
      tokens.push({ kind: "num", value: m[0] });
      i += m[0].length;
    } else if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(src.slice(i))!;
      tokens.push({ kind: "ident", value: m[0] });
      i += m[0].length;
    } else if ("+-*/^%(),".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
    } else {
      throw new SyntaxError(`unexpected character "${c}"`);
    }
  }
  return tokens;
}

export function compileExpression(src: string, variables: string[]): Evaluator {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new SyntaxError("empty expression");
  const vars = new Set(variables);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expectOp = (op: string) => {
    const t = next();
    if (!t || t.kind !== "op" || t.value !== op) {
      throw new SyntaxError(`expected "${op}"`);
    }
  };

  function parseExpr(): Evaluator {
    let left = parseTerm();
    while (peek()?.kind === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const right = parseTerm();
      const l = left;
      left = op === "+" ? (env) => l(env) + right(env) : (env) => l(env) - right(env);
    }
    return left;
  }

  function parseTerm(): Evaluator {
    let left = parseUnary();
    while (peek()?.kind === "op" && "*/%".includes(peek().value)) {
      const op = next().value;
      const right = parseUnary();
      const l = left;
      if (op === "*") left = (env) => l(env) * right(env);
      else if (op === "/") left = (env) => l(env) / right(env);
      else left = (env) => l(env) % right(env);
    }
    return left;
  }

  function parseUnary(): Evaluator {
    if (peek()?.kind === "op" && peek().value === "-") {
      next();
      const inner = parseUnary();
      return (env) => -inner(env);
    }
    return parsePower();
  }

  function parsePower(): Evaluator {
    const base = parsePrimary();
    if (peek()?.kind === "op" && peek().value === "^") {
      next();
      // Right-associative; unary minus in the exponent is allowed.
      const exponent = parseUnary();
      return (env) => Math.pow(base(env), exponent(env));
    }
    return base;
  }

  function parsePrimary(): Evaluator {
    const t = next();
    if (!t) throw new SyntaxError("unexpected end of expression");
    if (t.kind === "num") {
      const v = parseFloat(t.value);
      return () => v;
    }
    if (t.kind === "ident") {
      if (peek()?.kind === "op" && peek().value === "(") {
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new SyntaxError(`unknown function "${t.value}"`);
        next();
        const args: Evaluator[] = [];
        if (!(peek()?.kind === "op" && peek().value === ")")) {
          args.push(parseExpr());
          while (peek()?.kind === "op" && peek().value === ",") {
            next();
            args.push(parseExpr());
          }
        }
        expectOp(")");
        return (env) => fn(...args.map((a) => a(env)));
      }
      if (t.value in CONSTANTS) {
        const v = CONSTANTS[t.value];
        return () => v;
      }
      if (vars.has(t.value)) {
        const name = t.value;
        return (env) => env[name] ?? NaN;
      }
      throw new SyntaxError(`unknown identifier "${t.value}"`);
    }
    if (t.kind === "op" && t.value === "(") {
      const inner = parseExpr();
      expectOp(")");
      return inner;
    }
    throw new SyntaxError(`unexpected token "${t.value}"`);
  }

  const compiled = parseExpr();
  if (pos !== tokens.length) {
    throw new SyntaxError(`unexpected trailing input "${tokens[pos].value}"`);
  }
  return compiled;
}
