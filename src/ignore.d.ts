declare module 'ignore' {
  export interface Ignore {
    add(patterns: string | readonly string[]): Ignore;
    ignores(pathname: string): boolean;
  }

  export default function ignore(): Ignore;
}
