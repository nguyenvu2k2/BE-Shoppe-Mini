declare module 'bcrypt' {
  export function hash(data: string | Buffer, saltOrRounds: string | number): Promise<string>;

  export function compare(password: any, passwordHash: any): Promise<boolean>;
}
