-- Source for the desktop launcher app. Compiled by scripts/make-launcher.sh into
-- ~/Desktop/Financial Planning.app via osacompile — that .app is the actual
-- double-clickable launcher; this file just regenerates it if it's ever lost or
-- needs a change (edit here, then re-run scripts/make-launcher.sh).
on run
	try
		display notification "Starting Docker and the app…" with title "Financial Planning"
		do shell script quoted form of "/Users/morganstrutton/Financial-planning/scripts/launch-app.sh"
		display notification "Ready — opening in your browser." with title "Financial Planning"
	on error errMsg
		display alert "Couldn't start Financial Planning" message errMsg as critical
	end try
end run
