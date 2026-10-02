"use client";

import { clientInstance } from "@/lib/monitoring/rollbar-client";
import { useEffect } from "react";

interface GlobalErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
	useEffect(() => {
		clientInstance.error(error, {
			scope: "global-error-boundary",
			digest: error.digest,
		});
	}, [error]);

	return (
		<html lang="de">
			<body>
				<main style={{ padding: "24px", fontFamily: "Inter, Arial, sans-serif" }}>
					<h2>Ein kritischer Fehler ist aufgetreten.</h2>
					<button type="button" onClick={reset}>
						Neu laden
					</button>
				</main>
			</body>
		</html>
	);
}
