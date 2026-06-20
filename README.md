# Buying versus Renting Property for People under 30
## How to run locally (with WebStorm)

1. Clone the project
2. Install **WebStorm** from Jetbrains (https://www.jetbrains.com/webstorm/) or any other IDE that let's you deploy web-apps
3. Open the `index.html` in Webstorm and klick on the browser icon of your choice (red box), this will open the web-app in the browser you chose

![](img/browser.png)



## How to run locally (with python)

1. If you use Windows:

- Just double-click our WebsiteStart.bat to create a local python server which hosts the Website:

- WebsiteStart.bat code:

@echo off
cd /d "%~dp0"

start "" http://localhost:8000/index.html

python -m http.server 8000 --bind 127.0.0.1

2. If you use Linux:

- Open your Linux terminal.
- Navigate to the folder where your index.html file is located using the cd command: 
  - cd /path/to/your/project/folder
- Run the built-in Python HTTP server module: python3 -m http.server 8000

## How to run locally (with XAMPP/Apache server)

- Locate your local Installation of XAMPP and open the htdocs folder
- clone or copy and paste the project order into the htdocs folder
- run the apache server with the XAMPP control panel 
- now you double-click execute the index.html that is located in the htdocs folder

## Possible Errors:
If you get a Warning regarding the .json files you are executing the index.html file without running a local server.
You can do this but you need to allow your Browser of choice access to your local files.
- For Chrome this could work if you open "Windows Run" and execute 
  - "chrome.exe --allow-file-access-from-files"

BUT we do NOT recommend doing it this way.

## Dependencies

Everything our web-app needs is loaded automatically - you don't need to worry about any dependencies.
