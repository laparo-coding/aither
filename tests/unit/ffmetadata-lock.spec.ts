// ---------------------------------------------------------------------------
// Unit Tests: FFMetadata Per-Asset-ID Mutex (Spec 009)
// Task: T008 — serialized read-modify-write, no lost updates under concurrency.
// ---------------------------------------------------------------------------

import { _getLockCount, _resetLocks, withAssetLock } from "@/lib/recording/ffmetadata-lock";
import { beforeEach, describe, expect, it } from "vitest";

describe("withAssetLock", () => {
	beforeEach(() => {
		_resetLocks();
	});

	it("executes the function and returns its result", async () => {
		const result = await withAssetLock("asset1", async () => 42);
		expect(result).toBe(42);
	});

	it("serializes concurrent calls for the same asset id", async () => {
		const executionOrder: number[] = [];
		let currentExecution = 0;

		const tasks = Array.from({ length: 5 }, () =>
			withAssetLock("asset1", async () => {
				const myOrder = ++currentExecution;
				executionOrder.push(myOrder);
				await new Promise((resolve) => setTimeout(resolve, 10));
				return myOrder;
			}),
		);

		const results = await Promise.all(tasks);
		expect(results).toEqual([1, 2, 3, 4, 5]);
		expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
	});

	it("runs different asset ids in parallel", async () => {
		let concurrentCount = 0;
		let maxConcurrent = 0;

		const task = (assetId: string) =>
			withAssetLock(assetId, async () => {
				concurrentCount++;
				maxConcurrent = Math.max(maxConcurrent, concurrentCount);
				await new Promise((resolve) => setTimeout(resolve, 20));
				concurrentCount--;
				return assetId;
			});

		const results = await Promise.all([task("a"), task("b"), task("c")]);
		expect(results).toEqual(["a", "b", "c"]);
		expect(maxConcurrent).toBe(3); // all ran in parallel
	});

	it("releases the lock on error (try/finally)", async () => {
		await expect(
			withAssetLock("asset1", async () => {
				throw new Error("test error");
			}),
		).rejects.toThrow("test error");

		// Lock should be released — next call should succeed
		const result = await withAssetLock("asset1", async () => "ok");
		expect(result).toBe("ok");
		expect(_getLockCount()).toBe(0);
	});

	it("no lost updates — sequential appends produce all chapters", async () => {
		const chapters: number[] = [];

		const tasks = Array.from({ length: 10 }, (_, i) =>
			withAssetLock("asset1", async () => {
				chapters.push(i);
				return i;
			}),
		);

		await Promise.all(tasks);
		expect(chapters).toHaveLength(10);
		expect(chapters.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});
});
