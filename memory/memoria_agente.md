# Memoria del Agente (Long-Term Facts)

*Aquí puedes registrar hechos importantes, descubrimientos, o reglas que debes recordar a largo plazo sobre tus tareas.*

- [2026-03-10] REGLA ESTRICTA: Cuando termino desarrollos o el usuario me pide publicar, SIEMPRE debo subir la versión en `package.json`, hacer el build de NPM, crear el tag de Git y hacer push a GitHub (`git add .`, `git commit -m "..."`, `git tag vX.X.X`, `git push origin vX.X.X` y `git push`) para que el botón de actualización en la web siga funcionando e informe de la release correcta. Mantenimiento del repositorio es esencial.