"use client";

import { clientInstance } from "@/lib/monitoring/rollbar-client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect } from "react";

interface ErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AppError({ error, reset }: ErrorProps) {
	useEffect(() => {
		clientInstance.error(error, {
			scope: "app-error-boundary",
			digest: error.digest,
		});
	}, [error]);

	return (
		<Box sx={{ p: 3 }}>
			<Alert severity="error" sx={{ mb: 2 }}>
				Ein unerwarteter Fehler ist aufgetreten.
			</Alert>
			<Typography variant="body2" sx={{ mb: 2 }}>
				Bitte versuche es erneut.
			</Typography>
			<Button variant="contained" onClick={reset}>
				Erneut versuchen
			</Button>
		</Box>
	);
}
