package edu.library;
import java.io.IOException;
import java.sql.Timestamp;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
@Configuration
class JsonConfiguration {
 @Bean Jackson2ObjectMapperBuilderCustomizer timestamps(){return builder->builder.serializerByType(Timestamp.class,new JsonSerializer<Timestamp>(){
  @Override public void serialize(Timestamp value,JsonGenerator out,SerializerProvider provider)throws IOException {
   out.writeString(value.toLocalDateTime().toString());
  }
 });}
}
