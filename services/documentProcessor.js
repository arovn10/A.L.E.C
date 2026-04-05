#!/usr/bin/env node
/**
 * A.L.E.C. Document Processing Service
 * Real Estate Analyst capabilities for document analysis
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth'); // For .docx files
require('dotenv').config();

class DocumentProcessor {
  constructor() {
    this.uploadDir = './uploads';
    this.processedDir = './processed-documents';

    // Ensure directories exist
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    if (!fs.existsSync(this.processedDir)) {
      fs.mkdirSync(this.processedDir, { recursive: true });
    }

    console.log('📄 Document Processor initialized');
  }

  async uploadDocument(file, userId) {
    try {
      const fileName = `${userId}_${Date.now()}_${file.originalname}`;
      const filePath = path.join(this.uploadDir, fileName);

      // Save uploaded file
      fs.writeFileSync(filePath, file.buffer);

      console.log(`✅ Document uploaded: ${fileName}`);

      return {
        success: true,
        filename: fileName,
        filepath: filePath,
        size: file.size,
        type: file.mimetype,
        userId: userId
      };

    } catch (error) {
      console.error('❌ Document upload failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async processDocument(filePath, fileName) {
    try {
      const extension = path.extname(fileName).toLowerCase();
      let content = '';

      switch (extension) {
        case '.pdf':
          content = await this.extractPDFContent(filePath);
          break;

        case '.docx':
          content = await this.extractDocxContent(filePath);
          break;

        case '.txt':
          content = fs.readFileSync(filePath, 'utf8');
          break;

        default:
          return { success: false, error: `Unsupported file type: ${extension}` };
      }

      // Move to processed directory
      const processedPath = path.join(this.processedDir, fileName);
      fs.renameSync(filePath, processedPath);

      console.log(`✅ Document processed: ${fileName}`);

      return {
        success: true,
        content: content,
        filename: fileName,
        wordCount: this.countWords(content)
      };

    } catch (error) {
      console.error('❌ Document processing failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async extractPDFContent(filePath) {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      return pdfData.text;
    } catch (error) {
      throw new Error(`Failed to extract PDF: ${error.message}`);
    }
  }

  async extractDocxContent(filePath) {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch (error) {
      throw new Error(`Failed to extract DOCX: ${error.message}`);
    }
  }

  countWords(text) {
    return text.trim().split(/\s+/).length;
  }

  async analyzeAsRealEstateAnalyst(docContent, userId) {
    try {
      // This would integrate with the LLM to analyze documents as a real estate analyst
      const analysis = {
        documentType: this.identifyDocumentType(docContent),
        keyMetrics: await this.extractRealEstateMetrics(docContent),
        riskFactors: await this.assessRiskFactors(docContent),
        recommendations: await this.generateRecommendations(docContent, userId),
        summary: await this.generateSummary(docContent)
      };

      // Save analysis to database (STOA)
      await this.saveAnalysisToDatabase({ docId: Date.now(), analysis, userId });

      return { success: true, analysis };

    } catch (error) {
      console.error('❌ Real estate analysis failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  identifyDocumentType(content) {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('lease') && lowerContent.includes('tenant')) return 'Lease Agreement';
    if (lowerContent.includes('property') && lowerContent.includes('valuation')) return 'Property Valuation Report';
    if (lowerContent.includes('market') && lowerContent.includes('analysis')) return 'Market Analysis';
    if (lowerContent.includes('financial')) return 'Financial Statement';
    if (lowerContent.includes('investment') && lowerContent.includes('memorandum')) return 'Investment Memorandum';

    return 'General Document';
  }

  async extractRealEstateMetrics(content) {
    // Extract key real estate metrics from document content
    const metrics = [];

    // Price/Value extraction
    const priceMatch = content.match(/\$[\d,]+(?:\.\d{2})?/g);
    if (priceMatch) {
      metrics.push({ type: 'property_value', value: priceMatch[0] });
    }

    // Rental income extraction
    const rentalMatch = content.match(/rental\s+income[:\s]+\$[\d,]+/gi);
    if (rentalMatch) {
      metrics.push({ type: 'rental_income', value: rentalMatch[0].replace(/\s+/g, ' ') });
    }

    // Cap rate extraction
    const capRateMatch = content.match(/cap\s+rate[:\s]+[\d.]+%/gi);
    if (capRateMatch) {
      metrics.push({ type: 'cap_rate', value: capRateMatch[0].replace(/\s+/g, ' ') });
    }

    // NOI extraction
    const noiMatch = content.match(/NOI[:\s]+\$[\d,]+/gi);
    if (noiMatch) {
      metrics.push({ type: 'net_operating_income', value: noiMatch[0].replace(/\s+/g, ' ') });
    }

    return metrics;
  }

  async assessRiskFactors(content) {
    const risks = [];

    // Check for common risk indicators
    if (content.toLowerCase().includes('vacancy rate') && content.match(/vacancy\s+rate[:\s]+[\d.]+%/)?.[0].includes('15')) {
      risks.push({ type: 'high_vacancy', severity: 'medium' });
    }

    if (content.toLowerCase().includes('debt service coverage') && content.match(/DSCR[:\s]+[\d.]+/)?.[0].match(/< 1\.2/) !== null) {
      risks.push({ type: 'low_dscr', severity: 'high' });
    }

    if (content.toLowerCase().includes('environmental')) {
      risks.push({ type: 'environmental_concerns', severity: 'medium' });
    }

    return risks;
  }

  async generateRecommendations(content, userId) {
    // Generate real estate analyst recommendations
    const recommendations = [
      'Consider diversifying tenant mix to reduce vacancy risk',
      'Evaluate property improvements to increase rental income',
      'Review lease terms for favorable renewal options',
      'Monitor local market trends for pricing optimization'
    ];

    return recommendations;
  }

  async generateSummary(content) {
    // Generate document summary (would use LLM in production)
    const wordCount = this.countWords(content);

    return `This is a ${wordCount} word real estate document. Key topics include property valuation, financial analysis, and market assessment.`;
  }

  async saveAnalysisToDatabase({ docId, analysis, userId }) {
    // Save to STOA database for permanent storage
    try {
      const { STOADatabase } = require('./stoaDatabase');
      const db = new STOADatabase();

      await db.connect();

      await db.pool.query(`
        INSERT INTO document_analysis (doc_id, user_id, analysis_data)
        VALUES ($1, $2, $3)
      `, [docId, userId, JSON.stringify(analysis)]);

    } catch (error) {
      console.error('❌ Failed to save analysis to database:', error.message);
    }
  }

  async getDocumentHistory(userId) {
    // Retrieve user's document history from database
    return [];
  }

  async deleteDocument(fileName, userId) {
    try {
      const filePath = path.join(this.uploadDir, fileName);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✅ Document deleted: ${fileName}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Failed to delete document:', error.message);
      return false;
    }
  }
}

module.exports = { DocumentProcessor };
