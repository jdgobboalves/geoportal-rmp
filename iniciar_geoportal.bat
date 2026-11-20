@echo off
REM Inicia um servidor local e abre o Geoportal RMP no navegador.
REM (Navegadores bloqueiam a leitura dos GeoJSON quando o index.html e aberto direto do disco.)
cd /d "%~dp0"
set PORTA=8000
start "" http://localhost:%PORTA%/

where python >nul 2>nul && (python -m http.server %PORTA% & goto :eof)
where py >nul 2>nul && (py -m http.server %PORTA% & goto :eof)
if exist "C:\Program Files\QGIS 3.44.15\bin\python-qgis-ltr.bat" (
  call "C:\Program Files\QGIS 3.44.15\bin\python-qgis-ltr.bat" -m http.server %PORTA%
  goto :eof
)
echo Nenhum Python encontrado. Instale o Python ou ajuste o caminho do QGIS neste arquivo.
pause
