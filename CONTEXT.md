# Contexto del Proyecto

## 1. Transformación estructural del trading cripto

El mercado cripto dejó de ser un entorno compuesto por exchanges aislados y pasó a convertirse en una red fragmentada de liquidez, ejecución, custodia, settlement y datos. En esta red coexisten mercados centralizados, conocidos como **CEXs**, y mercados descentralizados, conocidos como **DEXs**. Los CEXs concentran profundidad de mercado, velocidad de ejecución, infraestructura profesional, APIs estandarizadas y productos derivados de alta liquidez. Los DEXs, por su parte, ofrecen liquidación on-chain, acceso permissionless, transparencia transaccional y nuevas formas de formación de precios mediante AMMs, order books on-chain, RFQ, intents, agregadores y protocolos de perpetuals descentralizados.

Esta convergencia ha creado una estructura de mercado híbrida, donde la liquidez ya no vive en un solo venue, sino distribuida entre múltiples capas: order books centralizados, pools AMM, perpetual DEXs, bridges, L2s, rollups, custodios, market makers, agregadores y redes de ejecución. En 2025, reportes de mercado destacaron que los CEXs seguían dominando el volumen agregado, pero los DEXs ganaron participación relevante, especialmente en spot y derivados on-chain, mostrando que el mercado se mueve hacia una arquitectura más multi-venue y programable.

## 2. Fragmentación de liquidez como origen de oportunidad algorítmica

La fragmentación de liquidez es el fenómeno central que justifica el sistema. Un mismo activo puede cotizar simultáneamente en Bybit, Binance, OKX, Coinbase, Hyperliquid, Uniswap, Curve, PancakeSwap, Raydium, Jupiter, GMX u otros venues. Cada venue tiene su propio mecanismo de formación de precio, profundidad, latencia, comisiones, funding, slippage, inventario disponible y riesgo de ejecución.

Esta fragmentación genera ineficiencias temporales: diferencias de precio entre CEXs, entre DEXs, entre CEX y DEX, y entre chains. En términos prácticos, estas diferencias pueden manifestarse como arbitraje espacial, arbitraje triangular, basis trading, funding arbitrage, latency arbitrage, cross-chain arbitrage o ejecución inteligente de órdenes. Estudios recientes sobre arbitraje CEX–DEX analizan precisamente cómo las diferencias entre AMMs y order books centralizados pueden explotarse, aunque los beneficios reales dependen de fricciones como slippage, gas, latencia, profundidad y riesgo operacional.

## 3. Diferencia fundamental entre CEX y DEX

Un **CEX** es una infraestructura financiera administrada por una entidad central. El exchange custodia fondos, opera el motor de matching, administra order books, provee APIs privadas y públicas, y ofrece productos como spot, margin, perpetual futures, options y copy trading. Su ventaja principal es la velocidad, liquidez y experiencia de usuario; su desventaja principal es el riesgo de contraparte, custodia, restricciones jurisdiccionales, congelamiento de fondos, límites de API y dependencia de infraestructura cerrada.

Un **DEX** es una infraestructura on-chain donde la ejecución ocurre mediante smart contracts. Puede usar AMMs, order books on-chain/off-chain, agregadores, intents, vaults o sistemas híbridos. Su ventaja principal es la liquidación transparente y la autonomía de custodia; sus riesgos incluyen vulnerabilidades de contratos inteligentes, MEV, congestión de red, reorgs, errores de bridge, slippage extremo y exposición pública de órdenes. En 2025, los reportes de DeFi enfatizaron que routing, bridging, matching y settlement se están volviendo capas invisibles para el usuario, pero no desaparecen como fuentes de riesgo técnico.

## 4. Evolución hacia trading multi-venue

El trading profesional cripto ya no puede entenderse como comprar o vender en un solo exchange. La infraestructura moderna opera sobre múltiples venues y busca la mejor combinación entre precio, profundidad, riesgo, latencia y costo total de ejecución. Esto implica comparar continuamente CEXs, DEXs, bridges, blockchains, pools, order books, funding rates y condiciones de mercado.

En un sistema multi-venue, cada operación puede tener varios caminos posibles. Por ejemplo, comprar un activo en un CEX y venderlo en un DEX; comprarlo en un DEX y venderlo en un CEX; arbitrar entre dos CEXs; arbitrar entre dos DEXs; cubrir una exposición spot con un perpetual; capturar funding; balancear inventario entre exchanges; o decidir no ejecutar porque el costo total supera la ventaja esperada.

El contexto técnico del proyecto nace de esta necesidad: construir una infraestructura capaz de observar, analizar, decidir y ejecutar dinámicamente en un mercado donde la oportunidad existe por segundos o milisegundos, y donde el error de ejecución puede convertir una oportunidad teórica en una pérdida real.

## 5. APIs de exchanges como capa de acceso programático

Las APIs son la interfaz operativa entre el sistema y los exchanges. En CEXs como Bybit, las APIs REST permiten consultar balances, colocar órdenes, cancelar órdenes, modificar posiciones, consultar historial y leer datos de mercado. Las APIs WebSocket permiten recibir datos en tiempo real sobre order books, trades, posiciones, fills y cambios de estado. Bybit V5, por ejemplo, unifica productos como spot, derivados y opciones bajo una API común, y sus WebSockets soportan streams públicos para mercados lineales como USDT y USDC perpetuals.

Esta capa es crítica porque el sistema no puede depender de interacción manual. Para operar algorítmicamente necesita conectividad persistente, manejo de autenticación, control de rate limits, reconciliación de órdenes, confirmación de fills y monitoreo de estado. La documentación de Bybit indica que la creación de órdenes es asíncrona y que debe usarse WebSocket para confirmar el estado de la orden, lo cual evidencia la necesidad de diseñar una arquitectura orientada a eventos y no solamente a peticiones REST secuenciales.

## 6. Smart contracts como capa de ejecución descentralizada

En DEXs, la ejecución no depende de una API centralizada tradicional, sino de smart contracts, RPC providers, wallets, relayers, routers, agregadores, firmantes, mempools y validadores. Esto introduce una diferencia sistémica: en un CEX, el problema principal es interactuar con un motor de matching privado; en un DEX, el problema principal es construir, simular, firmar, enviar y confirmar transacciones on-chain.

La ejecución en DEXs exige considerar gas, nonce management, slippage tolerance, aprobación de tokens, rutas de swap, liquidez por pool, oráculos, MEV, probabilidad de inclusión en bloque y riesgo de reversión. En arbitraje cross-chain, además, aparece el riesgo de bridges y la latencia de transferencia entre redes. Investigaciones sobre cross-chain arbitrage muestran que muchas operaciones exitosas dependen de inventario preposicionado, mientras que las rutas basadas en bridges introducen latencias significativamente mayores.

## 7. Necesidad de arquitectura multiagente

Un sistema de trading que opera entre CEXs y DEXs no debe ser diseñado como un bot monolítico. La complejidad del entorno exige separación de responsabilidades. Aquí surge la arquitectura multiagente: un conjunto de agentes especializados que colaboran, se supervisan y ejecutan tareas distintas bajo una política común de riesgo.

Un agente puede encargarse de datos de mercado; otro, de señales; otro, de arbitraje; otro, de ejecución; otro, de gestión de inventario; otro, de riesgo; otro, de compliance; otro, de auditoría; otro, de memoria histórica; y otro, de monitoreo de infraestructura. La literatura reciente sobre agentes financieros describe esta transición desde sistemas algorítmicos tradicionales hacia sistemas agentic, donde componentes como planner, orchestrator, alpha agents, risk agents, portfolio agents, execution agents, audit agents y memory agents se integran como módulos especializados.

## 8. AI Agents como capa cognitiva del sistema

Los AI Agents no reemplazan la lógica determinística de trading, sino que agregan una capa cognitiva para razonamiento, clasificación, interpretación de contexto, priorización de señales, diagnóstico de fallos y generación de hipótesis. En mercados de bajo signal-to-noise ratio, como cripto, esta capa puede ayudar a evaluar narrativas, resumir información, analizar eventos, detectar cambios estructurales y coordinar decisiones entre subsistemas.

Sin embargo, en un sistema de trading real, los agentes basados en LLM no deben tener control irrestricto sobre ejecución. Su rol debe estar encapsulado por reglas determinísticas de riesgo, validadores, circuit breakers y auditoría. La investigación reciente en agentes para inversión enfatiza aplicaciones como optimización de portafolio, gestión de riesgo, retrieval financiero y generación de estrategias, pero también señala retos abiertos en interpretabilidad, alineamiento, diseño sensible al riesgo e integración con humanos en contextos de alto impacto.

## 9. Orquestación como sistema nervioso operativo

La orquestación es la capa que coordina agentes, datos, decisiones y acciones. Sin orquestación, los agentes pueden producir señales contradictorias, ejecutar tareas redundantes o competir por recursos. En trading, esto es peligroso porque puede generar sobreexposición, órdenes duplicadas, errores de inventario o ejecuciones fuera de sincronía.

Una buena capa de orquestación define prioridades, dependencias, estados, permisos, límites, fallback logic y protocolos de comunicación. En términos de ingeniería, convierte un conjunto de agentes en un sistema coherente. En términos financieros, convierte múltiples fuentes de señal en una decisión ejecutable con control de riesgo. En términos operacionales, permite que cada acción tenga trazabilidad: qué agente la propuso, qué datos la justificaron, qué restricciones fueron evaluadas y qué resultado produjo.

Los frameworks modernos de agentes tienden a modelar flujos complejos como grafos de interacción entre agentes. Este enfoque es útil porque el trading multi-venue no es lineal: una señal puede activar validación de liquidez, cálculo de slippage, verificación de balances, simulación de gas, estimación de latencia, revisión de riesgo y finalmente ejecución o rechazo.

## 10. Harness Engineering como capa de evaluación y control

En este contexto, **Harness Engineering** puede entenderse como el diseño del arnés experimental y operativo que permite probar, contener, medir y controlar agentes y algoritmos. Un harness es una infraestructura que envuelve los componentes del sistema para evaluar su comportamiento bajo escenarios reproducibles.

Para trading, esto incluye backtesting, paper trading, simulación de fills, replay de order books, simulación de slippage, pruebas de estrés, pruebas de desconexión, validación de límites, mocks de APIs, pruebas de latencia y ambientes sandbox. Sin un harness robusto, el sistema puede parecer rentable en teoría pero fallar al enfrentar fricciones reales: comisiones, funding, colas de ejecución, partial fills, errores de API, cambios de liquidez o divergencias entre precio esperado y precio realizado.

El harness es especialmente importante cuando se usan AI Agents, porque sus respuestas pueden variar según contexto, memoria, prompt y herramientas disponibles. Por eso, cada agente debe evaluarse no solo por su output, sino por su consistencia, reproducibilidad, seguridad operacional y capacidad de abstenerse cuando no existe ventaja estadística suficiente.

## 11. Loop Engineering como ciclo de percepción-decisión-acción-aprendizaje

**Loop Engineering** se refiere al diseño explícito de los ciclos cerrados del sistema. Un sistema de trading no es una secuencia única; es un ciclo continuo de observación, análisis, decisión, ejecución, monitoreo, aprendizaje y ajuste. Cada loop debe tener frecuencia, latencia tolerable, inputs, outputs, criterios de parada y condiciones de emergencia.

Un loop de datos puede operar en milisegundos o segundos. Un loop de riesgo puede operar cada vez que cambia una posición. Un loop de estrategia puede operar por vela, por evento o por cambio de volatilidad. Un loop de aprendizaje puede operar al cierre de sesión, semanalmente o después de cierto número de trades. Un loop de auditoría puede registrar cada decisión para reconstrucción posterior.

El riesgo de no diseñar loops explícitos es que el sistema se vuelva reactivo y caótico. En mercados cripto, donde la volatilidad puede comportarse como un proceso difusivo con saltos abruptos, los loops deben detectar transiciones de régimen: baja volatilidad a alta volatilidad, liquidez profunda a liquidez evaporada, tendencia a rango, mercado normal a evento extremo. El sistema debe poder cambiar de modo: operar, reducir exposición, cubrir, cancelar órdenes o quedarse en cash.

## 12. Graph Engineering como representación de mercados, agentes y flujos

**Graph Engineering** aporta una forma natural de representar el sistema. Los mercados multi-venue son grafos: nodos representan activos, exchanges, pools, chains, wallets, cuentas, agentes o estrategias; aristas representan rutas de intercambio, puentes, dependencias, correlaciones, flujos de capital o canales de comunicación.

En arbitraje, un grafo permite buscar ciclos rentables: USDT → ETH en un CEX, ETH → USDC en un DEX, USDC → USDT en otro venue. En routing, permite encontrar el camino con mejor precio neto después de fees, slippage y gas. En riesgo, permite detectar concentración: demasiada exposición al mismo activo, chain, stablecoin, exchange, bridge o proveedor RPC. En agentes, permite modelar qué componente puede invocar a otro y bajo qué restricciones.

La utilidad del grafo es que convierte un problema aparentemente caótico en una estructura matemática explotable. Las oportunidades de arbitraje son caminos; los riesgos sistémicos son dependencias; las restricciones son pesos; la liquidez es capacidad; la latencia es costo; y el capital disponible es flujo limitado.

## 13. Trading dinámico como problema de sistemas adaptativos

El objetivo operativo del sistema no es ejecutar una estrategia fija, sino tradear dinámicamente. Esto significa que el sistema debe adaptarse a cambios de volatilidad, liquidez, fees, funding, correlaciones, congestión on-chain, profundidad de order books, eventos macro, cambios regulatorios y comportamiento de participantes.

Desde una perspectiva de sistemas, el mercado es un sistema adaptativo complejo. Los agentes externos reaccionan a precios, noticias, liquidaciones, incentivos de funding, emisiones de tokens, unlocks, hackeos, governance, cambios de protocolo y migraciones de liquidez. Por tanto, una estrategia rentable en un régimen puede dejar de serlo en otro. El sistema debe evitar la ilusión de permanencia: ninguna ventaja estadística es eterna.

Por esta razón, el contexto del proyecto no es simplemente “crear un bot”, sino construir una infraestructura de adaptación. El sistema debe medir cuándo una estrategia pierde edge, cuándo una venue se vuelve riesgosa, cuándo una ruta deja de ser viable y cuándo la mejor operación es no operar.

## 14. Riesgo como principio arquitectónico central

En trading automatizado, el riesgo no es un módulo secundario; es la propiedad dominante del sistema. Los riesgos principales incluyen riesgo de mercado, riesgo de liquidez, riesgo de ejecución, riesgo de contraparte, riesgo de smart contract, riesgo de bridge, riesgo de API, riesgo de latencia, riesgo de modelo, riesgo de sobreajuste, riesgo de custodia y riesgo regulatorio.

IOSCO ha identificado áreas críticas para mercados de criptoactivos: conflictos de interés, manipulación de mercado, fraude, riesgos transfronterizos, custodia, protección de activos del cliente, riesgo operacional, riesgo tecnológico y acceso minorista. Estas categorías son directamente relevantes para un sistema que interactúa con CEXs y DEXs, porque cada operación automatizada toca al menos una de esas dimensiones.

En DeFi, además, aparecen riesgos específicos como MEV, vulnerabilidades de contratos, concentración de liquidez, errores de oráculo, ataques de governance y dependencia de infraestructura externa. Reportes de DeFi han señalado que el MEV se ha vuelto una dimensión estructural del mercado on-chain, especialmente en ambientes de alta actividad y ejecución competitiva.

## 15. Regulación y compliance como condición de diseño

El sistema debe entenderse dentro de un entorno regulatorio cada vez más estricto. La Unión Europea, mediante MiCA, avanzó hacia un marco formal para proveedores de servicios de criptoactivos, incluyendo autorizaciones, registros, reglas para stablecoins, conflictos de interés y obligaciones aplicables a CASPs. ESMA mantiene información sobre registros, autorizaciones y entidades no conformes bajo el marco MiCA.

Aunque el sistema sea técnico, no puede ignorar compliance. La automatización entre CEXs, DEXs y jurisdicciones puede implicar obligaciones de KYC, AML, sanciones, restricciones geográficas, tratamiento fiscal, reglas de derivados, protección de datos y términos de servicio de cada exchange. Por eso, el contexto del proyecto debe incluir desde el inicio una separación entre capacidad técnica y permisibilidad legal: que una operación sea técnicamente posible no significa que sea permitida, segura o sostenible.

## 16. Importancia de observabilidad, auditoría y trazabilidad

Un sistema multiagente que ejecuta trades debe ser observable. Esto significa que cada dato, decisión, orden, cancelación, error, fill, excepción y cambio de estado debe quedar registrado. Sin observabilidad, no se puede distinguir entre mala estrategia, mala ejecución, mala conectividad, mala liquidez o comportamiento inesperado de un agente.

La trazabilidad es también una forma de defensa. Si un agente recomienda una operación, el sistema debe saber qué datos usó, qué restricciones evaluó, qué versión del modelo estaba activa, qué prompt recibió, qué herramientas invocó y qué límites de riesgo aplicaban. Esto convierte el sistema en una infraestructura auditable, no en una caja negra.

En trading real, la auditoría permite reconstruir incidentes: por qué se abrió una posición, por qué no se cerró, por qué se duplicó una orden, por qué se aceptó un precio con slippage excesivo o por qué un stop no se ejecutó. Sin esta capa, el sistema puede generar pérdidas sin explicación reproducible.

## 17. Necesidad de separación entre señal, decisión y ejecución

Un error común en bots de trading es mezclar señal con ejecución. En una arquitectura robusta, detectar una oportunidad no equivale a ejecutarla. La señal debe pasar por capas de validación: ventaja esperada, costos, slippage, liquidez, latencia, exposición, correlación, riesgo de venue, estado de API, balances disponibles, límites de posición y condiciones de mercado.

Esta separación es aún más importante en sistemas con AI Agents. Un agente puede ser útil proponiendo hipótesis, clasificando regímenes o interpretando contexto, pero la decisión final debe estar filtrada por reglas explícitas. La ejecución debe ser determinística, controlada y reversible en la medida posible. En otras palabras: los agentes pueden asistir al razonamiento, pero el sistema de riesgo debe gobernar la acción.

## 18. Capital, inventario y liquidez como recursos limitados

El sistema debe gestionar capital como un recurso escaso distribuido entre venues. En arbitraje y market making, no basta con detectar diferencias de precio: se necesita inventario disponible en el lugar correcto, en el momento correcto y en el activo correcto. Mover fondos entre CEXs, DEXs y chains introduce costos, latencia y riesgo.

Por eso, el contexto del proyecto incluye gestión de inventario multi-venue. El sistema debe conocer saldos en exchanges, wallets, subcuentas, chains, stablecoins y tokens base. También debe estimar cuánto capital está libre, cuánto está comprometido en órdenes abiertas, cuánto está expuesto a riesgo de mercado y cuánto debe mantenerse como buffer para fees, gas, funding o margin calls.

En cross-chain arbitrage, la investigación muestra que el inventario preposicionado es clave porque depender de bridges en tiempo real introduce latencias que pueden destruir la oportunidad.

## 19. Infraestructura técnica como ventaja competitiva

En trading algorítmico, la estrategia no vive separada de la infraestructura. La latencia, confiabilidad, calidad de datos, manejo de errores, reconciliación de estado y capacidad de recuperación son parte del edge. Una estrategia matemáticamente sólida puede fallar si la infraestructura ejecuta tarde, lee datos inconsistentes, pierde eventos WebSocket o no detecta un partial fill.

La infraestructura debe contemplar conectores por exchange, normalización de datos, motor de eventos, message bus, almacenamiento histórico, control de secretos, sistema de permisos, colas de órdenes, simuladores, monitores, alertas y circuit breakers. También debe soportar modos distintos: backtest, paper trading, sandbox, producción limitada y producción completa.

En CEXs, esto implica robustez ante rate limits, time sync, desconexiones WebSocket y errores de orden. En DEXs, implica robustez ante RPC failure, gas spikes, nonce conflicts, failed transactions y MEV. Ambas capas requieren ingeniería defensiva.

## 20. Justificación del repositorio como base de investigación y producción

El repositorio existe como el núcleo técnico para consolidar esta infraestructura. Su propósito contextual es servir como base para un sistema capaz de operar en un mercado cripto fragmentado, programable, multi-venue y altamente competitivo. No se trata solamente de escribir estrategias aisladas, sino de construir una plataforma donde datos, agentes, grafos, loops, validadores, conectores y reglas de riesgo puedan interactuar de forma controlada.

El valor del proyecto está en integrar disciplinas. Desde economía, interpreta liquidez, incentivos, funding, demanda y estructura de mercado. Desde matemáticas, modela probabilidad, volatilidad, correlación, optimización y esperanza estadística. Desde física, entiende momentum, fricción, difusión, barreras de precio y transiciones de régimen. Desde computer science, implementa sistemas distribuidos, APIs, agentes, grafos, pipelines y automatización. Desde blockchain, incorpora smart contracts, wallets, gas, bridges, MEV y liquidación on-chain.

Este contexto posiciona el proyecto como una infraestructura de trading algorítmico multiagente para mercados cripto híbridos: CEX, DEX, CEX–CEX, DEX–DEX, CEX–DEX y DEX–CEX. Su fundamento no es la especulación manual, sino la construcción de un sistema adaptativo capaz de observar mercados, razonar sobre oportunidades, controlar riesgos, ejecutar con precisión y aprender de cada ciclo operativo.

## 21. Síntesis contextual

El proyecto nace de una realidad de mercado: la liquidez cripto está fragmentada, la ejecución es programable, las oportunidades son temporales y los riesgos son multidimensionales. Los CEXs ofrecen velocidad y profundidad; los DEXs ofrecen transparencia y composabilidad; los bridges conectan liquidez pero agregan latencia y riesgo; los perpetuals agregan exposición sintética y funding; los agentes agregan capacidad de razonamiento, pero requieren control estricto; y la orquestación convierte componentes aislados en un sistema operativo coherente.

Por tanto, el contexto esencial del repositorio es la creación de una infraestructura inteligente de trading multiagente, diseñada para operar dinámicamente en mercados centralizados y descentralizados, integrando APIs, smart contracts, AI Agents, orquestación, Harness Engineering, Loop Engineering y Graph Engineering. El desafío no es solo encontrar oportunidades, sino construir un sistema suficientemente robusto para evaluarlas, ejecutarlas o rechazarlas bajo condiciones reales de mercado, riesgo, regulación e infraestructura.