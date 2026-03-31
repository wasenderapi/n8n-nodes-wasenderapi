/*
 * Vendored and adapted from Project Nayuki's QR Code generator library (TypeScript).
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 * https://github.com/nayuki/QR-Code-generator
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

type Bit = number;
type Byte = number;
type Int = number;

interface BufferLike {
	readonly buffer: ArrayBufferLike;
	readonly byteOffset: number;
	readonly byteLength: number;
}

declare const Buffer: {
	from(data: ArrayBufferLike, byteOffset?: number, length?: number): BufferLike;
	from(data: string, encoding?: string): BufferLike;
};

const QR_MARGIN = 4;
const QR_SCALE = 8;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC32_TABLE = createCrc32Table();

export function renderQrCodeBuffer(qrCode: string): BufferLike {
	const qr = QrCode.encodeText(qrCode, QrCodeEcc.MEDIUM);
	const png = toPngBytes(qr, QR_MARGIN, QR_SCALE);

	return Buffer.from(png.buffer, png.byteOffset, png.byteLength);
}

function toPngBytes(qr: QrCode, border: number, scale: number): Uint8Array {
	if (border < 0) {
		throw new RangeError('Border must be non-negative');
	}

	if (!Number.isInteger(scale) || scale < 1) {
		throw new RangeError('Scale must be a positive integer');
	}

	const dimension = (qr.size + border * 2) * scale;
	const imageData = new Uint8Array((dimension * 4 + 1) * dimension);
	let offset = 0;

	for (let y = 0; y < dimension; y++) {
		imageData[offset++] = 0;
		const moduleY = Math.floor(y / scale) - border;

		for (let x = 0; x < dimension; x++) {
			const moduleX = Math.floor(x / scale) - border;
			const isDarkModule =
				moduleX >= 0 && moduleX < qr.size && moduleY >= 0 && moduleY < qr.size
					? qr.getModule(moduleX, moduleY)
					: false;
			const color = isDarkModule ? 0 : 255;

			imageData[offset++] = color;
			imageData[offset++] = color;
			imageData[offset++] = color;
			imageData[offset++] = 255;
		}
	}

	const headerChunk = createPngChunk(
		'IHDR',
		concatBytes(
			uint32ToBytes(dimension),
			uint32ToBytes(dimension),
			Uint8Array.from([8, 6, 0, 0, 0]),
		),
	);
	const dataChunk = createPngChunk('IDAT', createZlibData(imageData));
	const endChunk = createPngChunk('IEND', new Uint8Array(0));

	return concatBytes(PNG_SIGNATURE, headerChunk, dataChunk, endChunk);
}

function createZlibData(data: Uint8Array): Uint8Array {
	const header = Uint8Array.from([0x78, 0x01]);
	const blocks: Uint8Array[] = [];

	for (let offset = 0; offset < data.byteLength; offset += 0xffff) {
		const blockData = data.subarray(offset, Math.min(offset + 0xffff, data.byteLength));
		const isFinalBlock = offset + blockData.byteLength >= data.byteLength;
		const blockHeader = Uint8Array.from([
			isFinalBlock ? 0x01 : 0x00,
			blockData.byteLength & 0xff,
			(blockData.byteLength >>> 8) & 0xff,
			~blockData.byteLength & 0xff,
			(~blockData.byteLength >>> 8) & 0xff,
		]);

		blocks.push(concatBytes(blockHeader, blockData));
	}

	return concatBytes(header, ...blocks, uint32ToBytes(calculateAdler32(data)));
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
	if (type.length !== 4) {
		throw new RangeError('PNG chunk type must be four characters long');
	}

	const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
	const crcBytes = uint32ToBytes(calculateCrc32(concatBytes(typeBytes, data)));

	return concatBytes(uint32ToBytes(data.byteLength), typeBytes, data, crcBytes);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;

	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}

	return result;
}

function uint32ToBytes(value: number): Uint8Array {
	return Uint8Array.from([
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff,
	]);
}

function calculateCrc32(data: Uint8Array): number {
	let crc = 0xffffffff;

	for (const value of data) {
		crc = CRC32_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
	}

	return (crc ^ 0xffffffff) >>> 0;
}

function calculateAdler32(data: Uint8Array): number {
	let a = 1;
	let b = 0;

	for (const value of data) {
		a = (a + value) % 65521;
		b = (b + a) % 65521;
	}

	return ((b << 16) | a) >>> 0;
}

function createCrc32Table(): Uint32Array {
	const table = new Uint32Array(256);

	for (let index = 0; index < table.length; index++) {
		let value = index;

		for (let bit = 0; bit < 8; bit++) {
			value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}

		table[index] = value >>> 0;
	}

	return table;
}

function appendBits(value: Int, length: Int, buffer: Bit[]): void {
	if (length < 0 || length > 31 || value >>> length !== 0) {
		throw new RangeError('Value out of range');
	}

	for (let i = length - 1; i >= 0; i--) {
		buffer.push((value >>> i) & 1);
	}
}

function getBit(value: Int, index: Int): boolean {
	return ((value >>> index) & 1) !== 0;
}

function assert(condition: boolean): void {
	if (!condition) {
		throw new Error('Assertion error');
	}
}

class QrCode {
	static readonly MIN_VERSION: Int = 1;
	static readonly MAX_VERSION: Int = 40;
	private static readonly PENALTY_N1: Int = 3;
	private static readonly PENALTY_N2: Int = 3;
	private static readonly PENALTY_N3: Int = 40;
	private static readonly PENALTY_N4: Int = 10;

	private static readonly ECC_CODEWORDS_PER_BLOCK: number[][] = [
		[
			-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
			30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
		],
		[
			-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28,
			28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
		],
		[
			-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30,
			30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
		],
		[
			-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24,
			30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
		],
	];

	private static readonly NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
		[
			-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13,
			14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
		],
		[
			-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
			25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
		],
		[
			-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29,
			34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
		],
		[
			-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35,
			37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
		],
	];

	static encodeText(text: string, ecl: QrCodeEcc): QrCode {
		return QrCode.encodeSegments(QrSegment.makeSegments(text), ecl);
	}

	static encodeSegments(
		segments: readonly QrSegment[],
		ecl: QrCodeEcc,
		minVersion = 1,
		maxVersion = 40,
		mask = -1,
		boostEcl = true,
	): QrCode {
		if (
			!(
				QrCode.MIN_VERSION <= minVersion &&
				minVersion <= maxVersion &&
				maxVersion <= QrCode.MAX_VERSION
			) ||
			mask < -1 ||
			mask > 7
		) {
			throw new RangeError('Invalid value');
		}

		let version: Int;
		let dataUsedBits = 0;
		for (version = minVersion; ; version++) {
			const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
			const usedBits = QrSegment.getTotalBits(segments, version);
			if (usedBits <= dataCapacityBits) {
				dataUsedBits = usedBits;
				break;
			}
			if (version >= maxVersion) {
				throw new RangeError('Data too long');
			}
		}

		for (const newEcl of [QrCodeEcc.MEDIUM, QrCodeEcc.QUARTILE, QrCodeEcc.HIGH]) {
			if (boostEcl && dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8) {
				ecl = newEcl;
			}
		}

		const bitBuffer: Bit[] = [];
		for (const segment of segments) {
			appendBits(segment.mode.modeBits, 4, bitBuffer);
			appendBits(segment.numChars, segment.mode.numCharCountBits(version), bitBuffer);
			for (const bit of segment.getData()) {
				bitBuffer.push(bit);
			}
		}
		assert(bitBuffer.length === dataUsedBits);

		const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
		assert(bitBuffer.length <= dataCapacityBits);
		appendBits(0, Math.min(4, dataCapacityBits - bitBuffer.length), bitBuffer);
		appendBits(0, (8 - (bitBuffer.length % 8)) % 8, bitBuffer);
		assert(bitBuffer.length % 8 === 0);

		for (let padByte = 0xec; bitBuffer.length < dataCapacityBits; padByte ^= 0xec ^ 0x11) {
			appendBits(padByte, 8, bitBuffer);
		}

		const dataCodewords: Byte[] = [];
		while (dataCodewords.length * 8 < bitBuffer.length) {
			dataCodewords.push(0);
		}
		bitBuffer.forEach((bit, index) => {
			dataCodewords[index >>> 3] |= bit << (7 - (index & 7));
		});

		return new QrCode(version, ecl, dataCodewords, mask);
	}

	readonly size: Int;
	readonly mask: Int;
	private readonly modules: boolean[][] = [];
	private isFunction: boolean[][] = [];

	constructor(
		public readonly version: Int,
		public readonly errorCorrectionLevel: QrCodeEcc,
		dataCodewords: readonly Byte[],
		mask: Int,
	) {
		if (version < QrCode.MIN_VERSION || version > QrCode.MAX_VERSION) {
			throw new RangeError('Version value out of range');
		}
		if (mask < -1 || mask > 7) {
			throw new RangeError('Mask value out of range');
		}

		this.size = version * 4 + 17;

		const row = Array<boolean>(this.size).fill(false);
		for (let i = 0; i < this.size; i++) {
			this.modules.push([...row]);
			this.isFunction.push([...row]);
		}

		this.drawFunctionPatterns();
		const allCodewords = this.addEccAndInterleave(dataCodewords);
		this.drawCodewords(allCodewords);

		if (mask === -1) {
			let minPenalty = 1_000_000_000;
			for (let i = 0; i < 8; i++) {
				this.applyMask(i);
				this.drawFormatBits(i);
				const penalty = this.getPenaltyScore();
				if (penalty < minPenalty) {
					mask = i;
					minPenalty = penalty;
				}
				this.applyMask(i);
			}
		}

		assert(0 <= mask && mask <= 7);
		this.mask = mask;
		this.applyMask(mask);
		this.drawFormatBits(mask);
		this.isFunction = [];
	}

	getModule(x: Int, y: Int): boolean {
		return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
	}

	private drawFunctionPatterns(): void {
		for (let i = 0; i < this.size; i++) {
			this.setFunctionModule(6, i, i % 2 === 0);
			this.setFunctionModule(i, 6, i % 2 === 0);
		}

		this.drawFinderPattern(3, 3);
		this.drawFinderPattern(this.size - 4, 3);
		this.drawFinderPattern(3, this.size - 4);

		const alignmentPatternPositions = this.getAlignmentPatternPositions();
		const numAlign = alignmentPatternPositions.length;
		for (let i = 0; i < numAlign; i++) {
			for (let j = 0; j < numAlign; j++) {
				if (
					!(i === 0 && j === 0) &&
					!(i === 0 && j === numAlign - 1) &&
					!(i === numAlign - 1 && j === 0)
				) {
					this.drawAlignmentPattern(alignmentPatternPositions[i], alignmentPatternPositions[j]);
				}
			}
		}

		this.drawFormatBits(0);
		this.drawVersion();
	}

	private drawFormatBits(mask: Int): void {
		const data = (this.errorCorrectionLevel.formatBits << 3) | mask;
		let remainder = data;
		for (let i = 0; i < 10; i++) {
			remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
		}
		const bits = ((data << 10) | remainder) ^ 0x5412;
		assert(bits >>> 15 === 0);

		for (let i = 0; i <= 5; i++) {
			this.setFunctionModule(8, i, getBit(bits, i));
		}
		this.setFunctionModule(8, 7, getBit(bits, 6));
		this.setFunctionModule(8, 8, getBit(bits, 7));
		this.setFunctionModule(7, 8, getBit(bits, 8));
		for (let i = 9; i < 15; i++) {
			this.setFunctionModule(14 - i, 8, getBit(bits, i));
		}

		for (let i = 0; i < 8; i++) {
			this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
		}
		for (let i = 8; i < 15; i++) {
			this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
		}
		this.setFunctionModule(8, this.size - 8, true);
	}

	private drawVersion(): void {
		if (this.version < 7) {
			return;
		}

		let remainder = this.version;
		for (let i = 0; i < 12; i++) {
			remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
		}
		const bits = (this.version << 12) | remainder;
		assert(bits >>> 18 === 0);

		for (let i = 0; i < 18; i++) {
			const color = getBit(bits, i);
			const a = this.size - 11 + (i % 3);
			const b = Math.floor(i / 3);
			this.setFunctionModule(a, b, color);
			this.setFunctionModule(b, a, color);
		}
	}

	private drawFinderPattern(x: Int, y: Int): void {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const distance = Math.max(Math.abs(dx), Math.abs(dy));
				const moduleX = x + dx;
				const moduleY = y + dy;
				if (0 <= moduleX && moduleX < this.size && 0 <= moduleY && moduleY < this.size) {
					this.setFunctionModule(moduleX, moduleY, distance !== 2 && distance !== 4);
				}
			}
		}
	}

	private drawAlignmentPattern(x: Int, y: Int): void {
		for (let dy = -2; dy <= 2; dy++) {
			for (let dx = -2; dx <= 2; dx++) {
				this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
			}
		}
	}

	private setFunctionModule(x: Int, y: Int, isDark: boolean): void {
		this.modules[y][x] = isDark;
		this.isFunction[y][x] = true;
	}

	private addEccAndInterleave(data: readonly Byte[]): Byte[] {
		const version = this.version;
		const ecl = this.errorCorrectionLevel;
		if (data.length !== QrCode.getNumDataCodewords(version, ecl)) {
			throw new RangeError('Invalid argument');
		}

		const numBlocks = QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][version];
		const blockEccLength = QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][version];
		const rawCodewords = Math.floor(QrCode.getNumRawDataModules(version) / 8);
		const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
		const shortBlockLength = Math.floor(rawCodewords / numBlocks);

		const blocks: Byte[][] = [];
		const rsDivisor = QrCode.reedSolomonComputeDivisor(blockEccLength);
		for (let i = 0, k = 0; i < numBlocks; i++) {
			const dataBlock = data.slice(
				k,
				k + shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1),
			);
			k += dataBlock.length;
			const ecc = QrCode.reedSolomonComputeRemainder(dataBlock, rsDivisor);
			if (i < numShortBlocks) {
				dataBlock.push(0);
			}
			blocks.push([...dataBlock, ...ecc]);
		}

		const result: Byte[] = [];
		for (let i = 0; i < blocks[0].length; i++) {
			blocks.forEach((block, blockIndex) => {
				if (i !== shortBlockLength - blockEccLength || blockIndex >= numShortBlocks) {
					result.push(block[i]);
				}
			});
		}

		assert(result.length === rawCodewords);
		return result;
	}

	private drawCodewords(data: readonly Byte[]): void {
		if (data.length !== Math.floor(QrCode.getNumRawDataModules(this.version) / 8)) {
			throw new RangeError('Invalid argument');
		}

		let bitIndex = 0;
		for (let right = this.size - 1; right >= 1; right -= 2) {
			if (right === 6) {
				right = 5;
			}
			for (let vertical = 0; vertical < this.size; vertical++) {
				for (let j = 0; j < 2; j++) {
					const x = right - j;
					const upward = ((right + 1) & 2) === 0;
					const y = upward ? this.size - 1 - vertical : vertical;
					if (!this.isFunction[y][x] && bitIndex < data.length * 8) {
						this.modules[y][x] = getBit(data[bitIndex >>> 3], 7 - (bitIndex & 7));
						bitIndex++;
					}
				}
			}
		}

		assert(bitIndex === data.length * 8);
	}

	private applyMask(mask: Int): void {
		if (mask < 0 || mask > 7) {
			throw new RangeError('Mask value out of range');
		}

		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) {
				let invert: boolean;
				switch (mask) {
					case 0:
						invert = (x + y) % 2 === 0;
						break;
					case 1:
						invert = y % 2 === 0;
						break;
					case 2:
						invert = x % 3 === 0;
						break;
					case 3:
						invert = (x + y) % 3 === 0;
						break;
					case 4:
						invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
						break;
					case 5:
						invert = ((x * y) % 2) + ((x * y) % 3) === 0;
						break;
					case 6:
						invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
						break;
					case 7:
						invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
						break;
					default:
						throw new Error('Unreachable');
				}

				if (!this.isFunction[y][x] && invert) {
					this.modules[y][x] = !this.modules[y][x];
				}
			}
		}
	}

	private getPenaltyScore(): Int {
		let result = 0;

		for (let y = 0; y < this.size; y++) {
			let runColor = false;
			let runLength = 0;
			const runHistory = [0, 0, 0, 0, 0, 0, 0];
			for (let x = 0; x < this.size; x++) {
				if (this.modules[y][x] === runColor) {
					runLength++;
					if (runLength === 5) {
						result += QrCode.PENALTY_N1;
					} else if (runLength > 5) {
						result++;
					}
				} else {
					this.finderPenaltyAddHistory(runLength, runHistory);
					if (!runColor) {
						result += this.finderPenaltyCountPatterns(runHistory) * QrCode.PENALTY_N3;
					}
					runColor = this.modules[y][x];
					runLength = 1;
				}
			}
			result +=
				this.finderPenaltyTerminateAndCount(runColor, runLength, runHistory) * QrCode.PENALTY_N3;
		}

		for (let x = 0; x < this.size; x++) {
			let runColor = false;
			let runLength = 0;
			const runHistory = [0, 0, 0, 0, 0, 0, 0];
			for (let y = 0; y < this.size; y++) {
				if (this.modules[y][x] === runColor) {
					runLength++;
					if (runLength === 5) {
						result += QrCode.PENALTY_N1;
					} else if (runLength > 5) {
						result++;
					}
				} else {
					this.finderPenaltyAddHistory(runLength, runHistory);
					if (!runColor) {
						result += this.finderPenaltyCountPatterns(runHistory) * QrCode.PENALTY_N3;
					}
					runColor = this.modules[y][x];
					runLength = 1;
				}
			}
			result +=
				this.finderPenaltyTerminateAndCount(runColor, runLength, runHistory) * QrCode.PENALTY_N3;
		}

		for (let y = 0; y < this.size - 1; y++) {
			for (let x = 0; x < this.size - 1; x++) {
				const color = this.modules[y][x];
				if (
					color === this.modules[y][x + 1] &&
					color === this.modules[y + 1][x] &&
					color === this.modules[y + 1][x + 1]
				) {
					result += QrCode.PENALTY_N2;
				}
			}
		}

		let dark = 0;
		for (const row of this.modules) {
			dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
		}
		const total = this.size * this.size;
		const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
		assert(0 <= k && k <= 9);
		result += k * QrCode.PENALTY_N4;
		assert(0 <= result && result <= 2_568_888);

		return result;
	}

	private getAlignmentPatternPositions(): Int[] {
		if (this.version === 1) {
			return [];
		}

		const numAlign = Math.floor(this.version / 7) + 2;
		const step = Math.floor((this.version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
		const result = [6];
		for (let position = this.size - 7; result.length < numAlign; position -= step) {
			result.splice(1, 0, position);
		}
		return result;
	}

	private static getNumRawDataModules(version: Int): Int {
		if (version < QrCode.MIN_VERSION || version > QrCode.MAX_VERSION) {
			throw new RangeError('Version number out of range');
		}

		let result = (16 * version + 128) * version + 64;
		if (version >= 2) {
			const numAlign = Math.floor(version / 7) + 2;
			result -= (25 * numAlign - 10) * numAlign - 55;
			if (version >= 7) {
				result -= 36;
			}
		}
		assert(208 <= result && result <= 29648);
		return result;
	}

	private static getNumDataCodewords(version: Int, ecl: QrCodeEcc): Int {
		return (
			Math.floor(QrCode.getNumRawDataModules(version) / 8) -
			QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][version] *
				QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][version]
		);
	}

	private static reedSolomonComputeDivisor(degree: Int): Byte[] {
		if (degree < 1 || degree > 255) {
			throw new RangeError('Degree out of range');
		}

		const result: Byte[] = [];
		for (let i = 0; i < degree - 1; i++) {
			result.push(0);
		}
		result.push(1);

		let root = 1;
		for (let i = 0; i < degree; i++) {
			for (let j = 0; j < result.length; j++) {
				result[j] = QrCode.reedSolomonMultiply(result[j], root);
				if (j + 1 < result.length) {
					result[j] ^= result[j + 1];
				}
			}
			root = QrCode.reedSolomonMultiply(root, 0x02);
		}

		return result;
	}

	private static reedSolomonComputeRemainder(
		data: readonly Byte[],
		divisor: readonly Byte[],
	): Byte[] {
		const result = divisor.map(() => 0);
		for (const value of data) {
			const factor = value ^ (result.shift() as Byte);
			result.push(0);
			divisor.forEach((coefficient, index) => {
				result[index] ^= QrCode.reedSolomonMultiply(coefficient, factor);
			});
		}
		return result;
	}

	private static reedSolomonMultiply(x: Byte, y: Byte): Byte {
		if (x >>> 8 !== 0 || y >>> 8 !== 0) {
			throw new RangeError('Byte out of range');
		}

		let z = 0;
		for (let i = 7; i >= 0; i--) {
			z = (z << 1) ^ ((z >>> 7) * 0x11d);
			z ^= ((y >>> i) & 1) * x;
		}
		assert(z >>> 8 === 0);
		return z as Byte;
	}

	private finderPenaltyCountPatterns(runHistory: readonly Int[]): Int {
		const n = runHistory[1];
		assert(n <= this.size * 3);
		const core =
			n > 0 &&
			runHistory[2] === n &&
			runHistory[3] === n * 3 &&
			runHistory[4] === n &&
			runHistory[5] === n;
		return (
			(core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
			(core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
		);
	}

	private finderPenaltyTerminateAndCount(
		currentRunColor: boolean,
		currentRunLength: Int,
		runHistory: Int[],
	): Int {
		if (currentRunColor) {
			this.finderPenaltyAddHistory(currentRunLength, runHistory);
			currentRunLength = 0;
		}

		currentRunLength += this.size;
		this.finderPenaltyAddHistory(currentRunLength, runHistory);
		return this.finderPenaltyCountPatterns(runHistory);
	}

	private finderPenaltyAddHistory(currentRunLength: Int, runHistory: Int[]): void {
		if (runHistory[0] === 0) {
			currentRunLength += this.size;
		}
		runHistory.pop();
		runHistory.unshift(currentRunLength);
	}
}

class QrSegment {
	private static readonly NUMERIC_REGEX = /^[0-9]*$/;
	private static readonly ALPHANUMERIC_REGEX = /^[A-Z0-9 $%*+./:-]*$/;
	private static readonly ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

	static makeBytes(data: readonly Byte[]): QrSegment {
		const bitBuffer: Bit[] = [];
		for (const byte of data) {
			appendBits(byte, 8, bitBuffer);
		}
		return new QrSegment(QrSegmentMode.BYTE, data.length, bitBuffer);
	}

	static makeNumeric(digits: string): QrSegment {
		if (!QrSegment.isNumeric(digits)) {
			throw new RangeError('String contains non-numeric characters');
		}

		const bitBuffer: Bit[] = [];
		for (let i = 0; i < digits.length; ) {
			const n = Math.min(digits.length - i, 3);
			appendBits(Number.parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bitBuffer);
			i += n;
		}
		return new QrSegment(QrSegmentMode.NUMERIC, digits.length, bitBuffer);
	}

	static makeAlphanumeric(text: string): QrSegment {
		if (!QrSegment.isAlphanumeric(text)) {
			throw new RangeError('String contains unencodable characters in alphanumeric mode');
		}

		const bitBuffer: Bit[] = [];
		let i = 0;
		for (; i + 2 <= text.length; i += 2) {
			let value = QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45;
			value += QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
			appendBits(value, 11, bitBuffer);
		}
		if (i < text.length) {
			appendBits(QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6, bitBuffer);
		}

		return new QrSegment(QrSegmentMode.ALPHANUMERIC, text.length, bitBuffer);
	}

	static makeSegments(text: string): QrSegment[] {
		if (text === '') {
			return [];
		}
		if (QrSegment.isNumeric(text)) {
			return [QrSegment.makeNumeric(text)];
		}
		if (QrSegment.isAlphanumeric(text)) {
			return [QrSegment.makeAlphanumeric(text)];
		}
		return [QrSegment.makeBytes(QrSegment.toUtf8ByteArray(text))];
	}

	static isNumeric(text: string): boolean {
		return QrSegment.NUMERIC_REGEX.test(text);
	}

	static isAlphanumeric(text: string): boolean {
		return QrSegment.ALPHANUMERIC_REGEX.test(text);
	}

	static getTotalBits(segments: readonly QrSegment[], version: Int): number {
		let result = 0;
		for (const segment of segments) {
			const characterCountBits = segment.mode.numCharCountBits(version);
			if (segment.numChars >= 1 << characterCountBits) {
				return Number.POSITIVE_INFINITY;
			}
			result += 4 + characterCountBits + segment.bitData.length;
		}
		return result;
	}

	private static toUtf8ByteArray(text: string): Byte[] {
		const encoded = encodeURI(text);
		const result: Byte[] = [];
		for (let i = 0; i < encoded.length; i++) {
			if (encoded.charAt(i) !== '%') {
				result.push(encoded.charCodeAt(i));
			} else {
				result.push(Number.parseInt(encoded.substring(i + 1, i + 3), 16));
				i += 2;
			}
		}
		return result;
	}

	constructor(
		public readonly mode: QrSegmentMode,
		public readonly numChars: Int,
		private readonly bitData: Bit[],
	) {
		if (numChars < 0) {
			throw new RangeError('Invalid argument');
		}
		this.bitData = [...bitData];
	}

	getData(): Bit[] {
		return [...this.bitData];
	}
}

class QrCodeEcc {
	static readonly LOW = new QrCodeEcc(0, 1);
	static readonly MEDIUM = new QrCodeEcc(1, 0);
	static readonly QUARTILE = new QrCodeEcc(2, 3);
	static readonly HIGH = new QrCodeEcc(3, 2);

	private constructor(
		public readonly ordinal: Int,
		public readonly formatBits: Int,
	) {}
}

class QrSegmentMode {
	static readonly NUMERIC = new QrSegmentMode(0x1, [10, 12, 14]);
	static readonly ALPHANUMERIC = new QrSegmentMode(0x2, [9, 11, 13]);
	static readonly BYTE = new QrSegmentMode(0x4, [8, 16, 16]);
	static readonly ECI = new QrSegmentMode(0x7, [0, 0, 0]);

	private constructor(
		public readonly modeBits: Int,
		private readonly numBitsCharCount: readonly [Int, Int, Int],
	) {}

	numCharCountBits(version: Int): Int {
		return this.numBitsCharCount[Math.floor((version + 7) / 17)];
	}
}
