---
name: Auditor TLS y Puertos (TCP)
description: Comprueba puertos TCP abiertos, resolución DNS y validez de certificados TLS (SAN, fechas, cadena básica) para un host y puertos dados.
---

## Propósito
Permitir a Horus auditar rápidamente si un dominio tiene puertos TCP accesibles y si su certificado TLS es válido para el nombre (SNI/SAN), además de reportar fechas y emisor.

## Procedimiento recomendado
1. Resolver DNS (A/AAAA) del host.
2. Probar conectividad TCP a una lista de puertos (por defecto 80, 443, 4443).
3. Si el puerto es TLS (por defecto 443 y 4443), negociar handshake con SNI usando el host.
4. Extraer y reportar:
   - Versión TLS y cipher
   - Subject, Issuer
   - notBefore / notAfter
   - SubjectAltName
5. Conclusión clara: abierto/cerrado/filtrado por puerto y “cert válido para el host” + vigencia.

## Implementación (herramientas)
- Usa `functions.run_shell_local` ejecutando un script Python embebido que use `socket`, `ssl`.
- Para verificación estricta del certificado, usa `ssl.create_default_context()` (valida CA del sistema) y `wrap_socket(..., server_hostname=host)`.

## Plantilla de comando (Python)
Ejecuta algo equivalente a:

- `socket.getaddrinfo(host, port)` para resolver.
- Conectar TCP con timeout.
- TLS handshake y `getpeercert()`.

## Salida
Devuelve un informe en Markdown con:
- Resumen
- Tabla de puertos
- Detalles de certificado por puerto TLS
- Recomendaciones (firewall/NAT/reverse proxy) si procede.
