# SetupTool

`SetupTool` is a Java application designed to automate the setup process for a Java-based application. It provides cross-platform support for downloading and configuring Java Development Kit (JDK) 17, creating necessary directories, and generating platform-specific startup scripts.

## Features

- **Automatic JDK Download**  
  Downloads the appropriate JDK 17 binary for Windows, Linux, or macOS based on the operating system.

- **Setup Directory Creation**  
  Creates a `setup` directory in the current working directory to store setup-related files.

- **Startup Script Generation**  
  Generates startup scripts for both Windows (`ddb.bat`) and Linux/macOS (`ddb.sh`) platforms.

- **Cross-Platform Support**  
  Identifies the operating system and performs tasks accordingly.

---

## Usage

### Prerequisites
- Java Development Kit (JDK) 8 or later installed on your system.
- An active internet connection to download JDK 17 during the setup process.

### How to Run
1. **Compile the Code**  
   Open a terminal or command prompt and run the following commands to compile the application:
   ```bash
   javac -d out SetupTool.java
   ```
   Replace `SetupTool.java` with the correct file path if necessary.

2. **Run the Setup**  
   Execute the compiled program with the `--start-setup` argument:
   ```bash
   java -cp out github.hacimertgokhan.setup.SetupTool --start-setup
   ```

   If the argument `--start-setup` is not provided, the application will prompt you with usage instructions.

---

## Setup Process

1. **Setup Directory**  
   The program creates a `setup` folder in the current directory where all setup files will be stored.

2. **JDK Download**  
   The tool automatically detects your operating system and downloads the correct JDK binary:
    - Windows: `jdk-17_windows-x64_bin.exe`
    - Linux: `jdk-17_linux-x64_bin.tar.gz`
    - macOS: `jdk-17_macos-x64_bin.dmg`

3. **Startup Script Creation**  
   A startup script is generated based on the operating system:
    - Windows: `ddb.bat`
    - Linux/macOS: `ddb.sh`

   The scripts set up `JAVA_HOME` and `PATH` environment variables and execute `app.jar`.

4. **Execution Permission (Linux/macOS)**  
   The generated shell script (`ddb.sh`) is automatically made executable.

---

## File Structure

After running the setup, the directory structure will look like this:
```
project-directory/
│
├── setup/
│   ├── jdk17.exe (or .tar.gz/.dmg based on OS)
│   ├── ddb.bat (Windows startup script)
│   ├── ddb.sh (Linux/macOS startup script)
│
└── SetupTool.java
```

---

## Troubleshooting

- **Unsupported OS**  
  If you encounter an error like `Unsupported operating system`, ensure your OS is either Windows, Linux, or macOS.

- **File Permissions (Linux/macOS)**  
  If the shell script fails to execute, ensure it has executable permissions:
  ```bash
  chmod +x setup/ddb.sh
  ```

- **JDK Download Issues**  
  Ensure that your internet connection is stable. If the download fails, check if the JDK URL is accessible.

---

## Contributing

Contributions to enhance the functionality or support additional platforms are welcome. Fork this repository, make changes, and submit a pull request.

---

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

---

## Author

Developed by **Hacı Mert Gökhan**  
GitHub: [github.hacimertgokhan](https://github.com/hacimertgokhan)