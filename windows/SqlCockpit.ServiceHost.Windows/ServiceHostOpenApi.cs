namespace SqlCockpit.ServiceHost.Windows;
internal static class ServiceHostOpenApi
{
    internal const string Document = """
{
  "openapi": "3.0.3",
  "info": {
    "title": "SQL Cockpit Windows Host lane diagnostics",
    "version": "1.0.0",
    "description": "Local operational interface; distinct from the hosted dashboard API. Keep requireLocalRequests=true. Service key is required when configured; local keyless legacy mode remains supported."
  },
  "security": [
    {
      "serviceKey": []
    }
  ],
  "components": {
    "securitySchemes": {
      "serviceKey": {
        "type": "apiKey",
        "in": "header",
        "name": "X-SqlCockpit-Service-Key"
      }
    }
  },
  "paths": {
    "/health": {
      "get": {
        "summary": "Inspect Host health and lane identity",
        "description": "Read-only local Host inspection. No request body. Requires loopback when requireLocalRequests=true and the service key when configured. Not a public dashboard endpoint.",
        "responses": {
          "200": {
            "description": "Snapshot; excludes API key and credentials",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string"
                    },
                    "service": {
                      "type": "string"
                    },
                    "environmentId": {
                      "type": "string"
                    },
                    "channelName": {
                      "type": "string"
                    },
                    "serviceName": {
                      "type": "string"
                    },
                    "releaseVersion": {
                      "type": "string"
                    },
                    "buildSha": {
                      "type": "string"
                    },
                    "utcNow": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Host authorization failed"
          },
          "500": {
            "description": "Snapshot unavailable"
          }
        }
      }
    },
    "/api/runtime/environment": {
      "get": {
        "summary": "Inspect selected Host environment",
        "description": "Read-only local Host inspection. No request body. Requires loopback when requireLocalRequests=true and the service key when configured. Not a public dashboard endpoint.",
        "responses": {
          "200": {
            "description": "Snapshot; excludes API key and credentials",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "environmentId": {
                      "type": "string"
                    },
                    "channelName": {
                      "type": "string"
                    },
                    "serviceName": {
                      "type": "string"
                    },
                    "serviceControlUrl": {
                      "type": "string"
                    },
                    "settingsPath": {
                      "type": "string"
                    },
                    "repoRoot": {
                      "type": "string"
                    },
                    "apiRepoRoot": {
                      "type": "string"
                    },
                    "serviceRepoRoot": {
                      "type": "string"
                    },
                    "objectSearchRepoRoot": {
                      "type": "string"
                    },
                    "dataRoot": {
                      "type": "string"
                    },
                    "logsRoot": {
                      "type": "string"
                    },
                    "releaseVersion": {
                      "type": "string"
                    },
                    "buildSha": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Host authorization failed"
          },
          "500": {
            "description": "Snapshot unavailable"
          }
        }
      }
    },
    "/api/runtime/doctor": {
      "get": {
        "summary": "Inspect environment configuration and component health",
        "description": "Read-only local Host inspection. No request body. Requires loopback when requireLocalRequests=true and the service key when configured. Not a public dashboard endpoint.",
        "responses": {
          "200": {
            "description": "Snapshot; excludes API key and credentials",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "environment": {
                      "type": "object"
                    },
                    "checks": {
                      "type": "array",
                      "items": {
                        "type": "object"
                      }
                    },
                    "runtime": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Host authorization failed"
          },
          "500": {
            "description": "Snapshot unavailable"
          }
        }
      }
    }
  }
}
""";
}
