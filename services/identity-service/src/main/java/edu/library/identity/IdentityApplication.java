package edu.library.identity;

import java.util.Arrays;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class IdentityApplication {
    public static void main(String[] args) {
        if (Arrays.asList(args).contains("--register-ops1")) {
            OperatorRegistration.run(args);
            return;
        }
        SpringApplication.run(IdentityApplication.class, args);
    }
}
