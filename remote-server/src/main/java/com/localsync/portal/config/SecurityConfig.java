package com.localsync.portal.config;

import com.localsync.portal.repository.ApiKeyRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final ApiKeyRepository apiKeyRepository;

    public SecurityConfig(ApiKeyRepository apiKeyRepository) {
        this.apiKeyRepository = apiKeyRepository;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {

        // Add the API key filter before UsernamePasswordAuthenticationFilter
        http.addFilterBefore(
                new ApiKeyFilter(apiKeyRepository),
                UsernamePasswordAuthenticationFilter.class
        );

        // CSRF: disable for /api/** and admin login/logout
        http.csrf(csrf -> csrf
                .ignoringRequestMatchers(
                        new AntPathRequestMatcher("/api/**"),
                        new AntPathRequestMatcher("/admin/login"),
                        new AntPathRequestMatcher("/admin/logout")
                )
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
        );

        // Authorization rules
        http.authorizeHttpRequests(auth -> auth
                // Public: static assets, login page, gallery page
                .requestMatchers(
                        "/admin/login",
                        "/admin/login.html",
                        "/admin.html",
                        "/gallery.html",
                        "/css/**",
                        "/js/**"
                ).permitAll()

                // Public: gallery pages and photo serving
                .requestMatchers("/gallery/**").permitAll()
                .requestMatchers("/photos/**").permitAll()

                // Public: gallery API endpoints (read-only)
                .requestMatchers("/api/gallery/**").permitAll()

                // API endpoints (key-based auth handled by ApiKeyFilter)
                .requestMatchers("/api/upload", "/api/folders", "/api/folders/rename", "/api/folders/details", "/api/photos", "/api/sync/**").authenticated()

                // Admin API and pages require ADMIN role
                .requestMatchers("/api/admin/**").hasAuthority("ROLE_ADMIN")
                .requestMatchers("/admin/**").hasAuthority("ROLE_ADMIN")

                // Default: require authentication
                .anyRequest().authenticated()
        );

        // Disable form login (we use a custom POST /admin/login endpoint)
        http.formLogin(form -> form.disable());

        // Session management
        http.sessionManagement(session -> session
                .maximumSessions(5)
        );

        // Custom 401 handling: redirect to login for browser, JSON for API
        http.exceptionHandling(ex -> ex
                .authenticationEntryPoint((request, response, authException) -> {
                    String path = request.getRequestURI();
                    if (path.startsWith("/api/")) {
                        response.setStatus(401);
                        response.setContentType("application/json");
                        response.getWriter().write("{\"error\":\"Authentication required\"}");
                    } else {
                        response.sendRedirect("/admin.html");
                    }
                })
        );

        return http.build();
    }
}
