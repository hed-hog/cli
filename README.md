# <p align="center">@hedhog/cli</p>

<p align="center">
  <img src="https://avatars.githubusercontent.com/u/177489127?s=200&v=4" alt="Hedhog Avatar" />
</p>

The **HedHog CLI** is a command-line interface designed to simplify the process of creating new projects using the **HedHog** framework. It provides developers with a set of commands to quickly scaffold, configure, and manage their HedHog projects, reducing the amount of manual setup needed.

## Purpose

The **HedHog CLI** is aimed at streamlining the development process by allowing users to generate project templates, add modules, and manage their projects with ease. It automates common tasks and ensures that projects are structured according to best practices.

## Basic Commands

Below are the main commands provided by the CLI. Each command is prefixed with `hedhog`:

- **`hedhog new <project-name>`**  
  Initializes a new HedHog project in the specified directory. It will guide you through the configuration process, including setting up the backend, admin panel, and database.

- **`hedhog add <module>`**  
  Adds a new module to your HedHog project. You can use this to extend the functionality of your project by integrating additional components or features.

- **`hedhog create <feature>`**  
  Generates new modules, services, or features inside the project. This command helps quickly scaffold necessary files and structures.

- **`hedhog info`**  
  Displays information about the current project, such as version, installed modules, and configuration details.

- **`hedhog start`**  
  Starts the HedHog project in development mode, running both the backend API and admin interface. This command ensures that your project is up and running locally.

- **`hedhog refresh <module>`**
  Refreshes the module's configuration and dependencies. This command can help resolve issues related to outdated or mismatched settings, ensuring your project is up to date with the latest configurations and modules.

- **`hedhog reset <dependency>`**
  Redefine and reset the Hedhog project by removing additional dependencies and their related migrations.

## Folder Structure

The project follows a clear folder structure to ensure easy navigation and maintenance:

```plaintext
hedhog-cli/
├── actions/             # Contains the logic for each CLI action (e.g., adding modules, creating projects)
├── bin/                 # Contains the executable scripts for running the CLI
├── commands/            # Individual commands for the CLI (e.g., new, add, start)
├── lib/                 # Shared utility functions and libraries used by the CLI
├── node_modules/        # Installed dependencies required for the CLI to function
├── tools/               # Additional tools or helper scripts used by the CLI
├── .gitignore           # Specifies which files and folders to ignore in version control
├── .npmignore           # Specifies which files and folders to ignore when publishing the CLI to npm
├── .prettierrc          # Configuration for Prettier, ensuring consistent code formatting
├── package-lock.json    # Automatically generated file managing dependency versions
├── package.json         # Manages the dependencies and scripts for the CLI
├── README.md            # Documentation for the CLI project
└── tsconfig.json        # TypeScript configuration for the CLI project
```
