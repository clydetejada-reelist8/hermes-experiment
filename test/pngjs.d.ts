declare module "pngjs" {
  export class PNG {
    width: number;
    data: Buffer;
    constructor(options: { width: number; height: number });
    static sync: { write(png: PNG): Buffer };
  }
}
