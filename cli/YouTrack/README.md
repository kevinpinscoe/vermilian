# YouTrack cli

This directory contains command line interfaces used to communicate with my YouTrack self hosted instance which is at
https://youtrack.example.com

The self hosted instance Docker compose and container storage is located on this system in directory `~/containers/youtrack`.

## CLI area

A Go CLI targeting the self-hosted YouTrack instance at `https://youtrack.example.com`. Goal is to replace the bash scripts in [`scripts/YouTrack/hosted/`](../../scripts/YouTrack/README.md) with a single compiled binary.

## Goals

- Create automate backups 
- Create a create task command allowing to set the following properties:
	- Project
	- Category
	- Status
	- Due data
	- Ticket number
	- Ticket link
	- Tracking link
	- Notes
	- The custom field 'Date time entered' will automatically be set to the current date and time of the machine running the command.
- Dump all tasks as JSON in `~YouTrack/exports`.
- -Generate a daily stand-up report

## See also

- [Bash scripts](../../scripts/YouTrack/README.md) — current working implementation this CLI will replace
- [Vermilian README](../../README.md)


