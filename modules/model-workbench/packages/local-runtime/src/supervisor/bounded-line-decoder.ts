import { StringDecoder } from 'node:string_decoder';

export class BoundedLineDecoder {
  readonly #decoder = new StringDecoder('utf8');
  readonly #maximumLineBytes: number;
  #buffer = '';
  #bufferBytes = 0;

  constructor(maximumLineBytes: number) {
    this.#maximumLineBytes = maximumLineBytes;
  }

  push(chunk: Buffer): readonly string[] {
    this.#bufferBytes += chunk.byteLength;
    if (this.#bufferBytes > this.#maximumLineBytes) {
      const newline = chunk.indexOf(0x0a);
      if (newline < 0) throw new Error('Protocol message exceeds its byte limit.');
    }
    this.#buffer += this.#decoder.write(chunk);
    return this.#takeLines();
  }

  finish(): readonly string[] {
    this.#buffer += this.#decoder.end();
    const lines = this.#takeLines();
    if (this.#buffer.length === 0) return lines;
    if (Buffer.byteLength(this.#buffer, 'utf8') > this.#maximumLineBytes) {
      throw new Error('Protocol message exceeds its byte limit.');
    }
    const finalLine = this.#buffer;
    this.#buffer = '';
    this.#bufferBytes = 0;
    return [...lines, finalLine];
  }

  #takeLines(): string[] {
    const lines: string[] = [];
    let index = this.#buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.#buffer.slice(0, index).replace(/\r$/u, '');
      if (Buffer.byteLength(line, 'utf8') > this.#maximumLineBytes) {
        throw new Error('Protocol message exceeds its byte limit.');
      }
      lines.push(line);
      this.#buffer = this.#buffer.slice(index + 1);
      this.#bufferBytes = Buffer.byteLength(this.#buffer, 'utf8');
      index = this.#buffer.indexOf('\n');
    }
    return lines;
  }
}
