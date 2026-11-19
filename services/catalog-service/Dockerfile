FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src src
RUN mvn -B package -DskipTests
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/catalog-service-0.1.0.jar app.jar
RUN mkdir -p /app/web/covers && chown -R 10001 /app/web
USER 10001
EXPOSE 8082
ENTRYPOINT ["java","-jar","app.jar"]
