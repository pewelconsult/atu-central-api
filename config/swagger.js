// config/swagger.js
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ATU Alumni Database API',
      version: '1.0.0',
      description: 'Comprehensive API for ATU Alumni management system',
      termsOfService: 'http://example.com/terms/',
      contact: {
        name: 'ATU Alumni Support',
        url: 'http://www.atu.edu.gh',
        email: 'support@atu-alumni.edu.gh'
      },
      license: {
        name: 'MIT',
        url: 'https://choosealicense.com/licenses/mit/'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://api.atu-alumni.edu.gh',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        User: {
          type: 'object',
          required: ['email', 'password', 'firstName', 'lastName'],
          properties: {
            id: {
              type: 'string',
              description: 'User ID'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            firstName: {
              type: 'string',
              maxLength: 50,
              description: 'User first name'
            },
            lastName: {
              type: 'string',
              maxLength: 50,
              description: 'User last name'
            },
            role: {
              type: 'string',
              enum: ['alumni', 'admin', 'staff'],
              description: 'User role'
            },
            isVerified: {
              type: 'boolean',
              description: 'Email verification status'
            },
            isActive: {
              type: 'boolean',
              description: 'Account active status'
            },
            profileCompletion: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Profile completion percentage'
            },
            createdAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Profile: {
          type: 'object',
          properties: {
            user: {
              type: 'string',
              description: 'User ID reference'
            },
            phone: {
              type: 'string',
              description: 'Phone number'
            },
            location: {
              type: 'string',
              maxLength: 100,
              description: 'Location'
            },
            bio: {
              type: 'string',
              maxLength: 500,
              description: 'Biography'
            },
            profilePicture: {
              type: 'string',
              description: 'Profile picture URL'
            },
            resumeUrl: {
              type: 'string',
              description: 'Resume file URL'
            },
            graduationYear: {
              type: 'number',
              minimum: 1950,
              description: 'Graduation year'
            },
            program: {
              type: 'string',
              maxLength: 100,
              description: 'Academic program'
            },
            degree: {
              type: 'string',
              enum: ['Bachelor', 'Master', 'PhD', 'Diploma', 'Certificate', 'Other'],
              description: 'Degree type'
            },
            employmentStatus: {
              type: 'string',
              enum: ['Employed full-time', 'Employed part-time', 'Self-employed', 'Unemployed - seeking work', 'Unemployed - not seeking work', 'Student', 'Retired']
            },
            currentPosition: {
              type: 'string',
              maxLength: 100,
              description: 'Current job position'
            },
            currentCompany: {
              type: 'string',
              maxLength: 100,
              description: 'Current company'
            },
            skills: {
              type: 'array',
              items: {
                type: 'string',
                maxLength: 30
              },
              description: 'Skills array'
            },
            linkedIn: {
              type: 'string',
              format: 'uri',
              description: 'LinkedIn profile URL'
            },
            github: {
              type: 'string',
              format: 'uri',
              description: 'GitHub profile URL'
            },
            openToOpportunities: {
              type: 'boolean',
              description: 'Open to job opportunities'
            },
            availableForMentoring: {
              type: 'boolean',
              description: 'Available for mentoring'
            }
          }
        },
        Event: {
          type: 'object',
          required: ['title', 'description', 'eventType', 'startDate', 'endDate'],
          properties: {
            id: {
              type: 'string',
              description: 'Event ID'
            },
            title: {
              type: 'string',
              maxLength: 200,
              description: 'Event title'
            },
            description: {
              type: 'string',
              maxLength: 2000,
              description: 'Event description'
            },
            eventType: {
              type: 'string',
              enum: ['Networking', 'Career Development', 'Social', 'Academic', 'Alumni Meetup']
            },
            startDate: {
              type: 'string',
              format: 'date-time',
              description: 'Event start date and time'
            },
            endDate: {
              type: 'string',
              format: 'date-time',
              description: 'Event end date and time'
            },
            location: {
              type: 'object',
              properties: {
                venue: {
                  type: 'string',
                  description: 'Venue name'
                },
                address: {
                  type: 'string',
                  description: 'Full address'
                },
                city: {
                  type: 'string',
                  description: 'City'
                },
                isOnline: {
                  type: 'boolean',
                  description: 'Is online event'
                },
                onlineLink: {
                  type: 'string',
                  format: 'uri',
                  description: 'Online meeting link'
                }
              }
            },
            maxAttendees: {
              type: 'number',
              minimum: 1,
              description: 'Maximum number of attendees'
            },
            status: {
              type: 'string',
              enum: ['draft', 'published', 'cancelled', 'completed'],
              description: 'Event status'
            },
            organizer: {
              type: 'string',
              description: 'Organizer user ID'
            }
          }
        },
        Job: {
          type: 'object',
          required: ['title', 'description', 'company', 'employmentType', 'experienceLevel'],
          properties: {
            id: {
              type: 'string',
              description: 'Job ID'
            },
            title: {
              type: 'string',
              maxLength: 200,
              description: 'Job title'
            },
            description: {
              type: 'string',
              maxLength: 5000,
              description: 'Job description'
            },
            company: {
              type: 'string',
              description: 'Company name'
            },
            employmentType: {
              type: 'string',
              enum: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote']
            },
            experienceLevel: {
              type: 'string',
              enum: ['Entry Level', 'Mid Level', 'Senior Level', 'Executive']
            },
            location: {
              type: 'object',
              properties: {
                city: {
                  type: 'string'
                },
                country: {
                  type: 'string'
                },
                isRemote: {
                  type: 'boolean'
                }
              }
            },
            salaryRange: {
              type: 'object',
              properties: {
                min: {
                  type: 'number'
                },
                max: {
                  type: 'number'
                },
                currency: {
                  type: 'string',
                  default: 'GHS'
                },
                period: {
                  type: 'string',
                  enum: ['hourly', 'daily', 'weekly', 'monthly', 'yearly']
                }
              }
            },
            requirements: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            skills: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            status: {
              type: 'string',
              enum: ['active', 'paused', 'closed'],
              description: 'Job posting status'
            }
          }
        },
        Notification: {
          type: 'object',
          properties: {
            id: {
              type: 'string'
            },
            recipient: {
              type: 'string',
              description: 'Recipient user ID'
            },
            sender: {
              type: 'string',
              description: 'Sender user ID'
            },
            type: {
              type: 'string',
              enum: ['connection_request', 'connection_accepted', 'event_reminder', 'job_application', 'survey_invitation', 'system']
            },
            title: {
              type: 'string',
              maxLength: 100
            },
            message: {
              type: 'string',
              maxLength: 500
            },
            isRead: {
              type: 'boolean'
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent']
            },
            actionUrl: {
              type: 'string',
              description: 'URL to navigate when clicked'
            },
            createdAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              description: 'Error message'
            },
            errors: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Validation errors'
            }
          }
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              description: 'Success message'
            },
            data: {
              type: 'object',
              description: 'Response data'
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./routes/*.js'], // paths to files containing OpenAPI definitions
};

const specs = swaggerJsdoc(options);

module.exports = {
  specs,
  swaggerUi,
  serve: swaggerUi.serve,
  setup: swaggerUi.setup(specs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'ATU Alumni API Documentation'
  })
};

/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: User authentication and authorization
 *   - name: Alumni
 *     description: Alumni profile management and networking
 *   - name: Events
 *     description: Event management and RSVP system
 *   - name: Jobs
 *     description: Job postings and applications
 *   - name: Surveys
 *     description: Survey creation and response collection
 *   - name: Uploads
 *     description: File upload management
 *   - name: Notifications
 *     description: In-app notification system
 *   - name: Search
 *     description: Advanced search functionality
 *   - name: Admin
 *     description: Administrative functions
 */