import { AppHeader } from "@/app/components/header/AppHeader";
import { ThemeRegistry } from "@/app/components/theme/ThemeRegistry";
import { inter, playfairDisplay } from "@/app/fonts";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Aither",
	description: "Hemera Academy Integration",
	icons: {
		icon: "/favicon.png",
		apple: "/favicon.png",
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="de" className={`${inter.variable} ${playfairDisplay.variable}`}>
			<body>
				<ThemeRegistry>
					<AppHeader />
					{children}
				</ThemeRegistry>
			</body>
		</html>
	);
}
