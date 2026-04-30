// @ts-ignore
declare module 'node-cron' {
  function schedule(
    expression: string,
    func: () => void | Promise<void>,
    options?: { scheduled?: boolean; timezone?: string }
  ): { stop: () => void; start: () => void };
  function validate(expression: string): boolean;
  export { schedule, validate };
}
