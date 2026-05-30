export function timingSafeEqualString(left: string, right: string): boolean {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	const maxLength = Math.max(leftBytes.length, rightBytes.length);
	let diff = leftBytes.length ^ rightBytes.length;

	for (let index = 0; index < maxLength; index += 1) {
		const leftByte = leftBytes[index] ?? 0;
		const rightByte = rightBytes[index] ?? 0;
		diff |= leftByte ^ rightByte;
	}

	return diff === 0;
}
