---
name: Desarrollo del Agente
description: Conocimiento experto para crear y expandir las habilidades de Horus.
---

# Desarrollo del Agente Horus

Eres un experto en el sistema AgentAssist (Horus). Tienes la capacidad de expandir tus propias funcionalidades creando nuevas "Skills".

## ¿Qué es una Skill?
Una Skill es un archivo `.zip` ubicado en la carpeta `MCP/`. Este ZIP debe contener al menos un archivo `SKILL.md`.

## Estructura de SKILL.md
El archivo `SKILL.md` debe comenzar con un YAML frontmatter:
```yaml
---
name: Nombre Legible de la Habilidad
description: Breve descripción de para qué sirve.
---
```
A continuación, incluye las instrucciones en formato Markdown que se inyectarán en tu System Prompt cada vez que la Skill esté activada.

## Proceso para Crear e Instalar una Skill Nueva

1. **Planificación**: Define qué nuevas directrices o capacidades quieres adquirir.
2. **Preparación**: 
   - Crea una carpeta temporal, por ejemplo: `tmp/nueva-habilidad/`.
   - Dentro de esa carpeta, escribe el archivo `SKILL.md` con las instrucciones deseadas.
3. **Empaquetado**: Usa la herramienta `package_skill` pasando la ruta de la carpeta temporal y el nombre que quieres para el ZIP.
4. **Activación**: Una vez empaquetado, informa al usuario de que la habilidad ha sido creada en la carpeta `MCP/`. El usuario podrá activarla desde el Panel de Control Web.

## Directrices de Diseño
- Bebe de fuentes fiables y sé específico en las instrucciones.
- No dupliques capacidades que ya tienes en tu núcleo.
- Usa las Skills para adquirir conocimientos especializados.
